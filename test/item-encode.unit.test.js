const { expect } = require('chai');
const protobufjs = require('protobufjs');
const definitions = require('../lib/definitions.json');
const Item = require('../lib/item');

// Offline tests for Item._encode(): no credentials or network needed.
const protobuf = protobufjs.newBuilder({}).import(definitions).build('pcov.proto');

// A ListItem with every field populated, decoded the way list data arrives.
function decodedListItem(overrides = {}) {
	const quantity = { amount: '2', unit: 'cups', rawQuantity: '2 cups' };
	const packageSize = { size: '16', unit: 'oz', packageType: 'can', rawPackageSize: '16 oz can' };
	const item = new protobuf.ListItem({
		identifier: 'item-1',
		serverModTime: 1234567.5,
		listId: 'list-1',
		name: 'flour',
		details: 'unbleached',
		checked: false,
		recipeId: 'recipe-1',
		rawIngredient: '2 cups flour',
		priceMatchupTag: 'tag',
		priceId: 'price-1',
		category: 'baking',
		userId: 'user-1',
		categoryMatchId: 'baking',
		photoIds: ['photo-1', 'photo-2'],
		eventId: 'event-1',
		storeIds: ['store-1'],
		prices: [{ amount: 3.49, details: 'sale', storeId: 'store-1', date: '2026-09-01' }],
		categoryAssignments: [{ identifier: 'ca-1', categoryGroupId: 'group-1', categoryId: 'cat-1' }],
		quantityPb: quantity,
		priceQuantityPb: { amount: '1', unit: 'bag', rawQuantity: '1 bag' },
		priceQuantityShouldOverrideItemQuantity: true,
		packageSizePb: packageSize,
		pricePackageSizePb: packageSize,
		pricePackageSizeShouldOverrideItemPackageSize: true,
		ingredients: [
			{
				ingredient: { identifier: 'ing-1', rawIngredient: '2 cups flour', name: 'flour', quantity: '2 cups', note: 'sifted', isHeading: false },
				quantityPb: quantity,
				packageSizePb: packageSize,
				recipeId: 'recipe-1',
				eventId: 'event-1',
				recipeName: 'Bread',
				eventDate: '2026-09-27',
			},
			{
				ingredient: { identifier: 'ing-2', name: 'flour' },
				recipeId: 'recipe-2',
				recipeName: 'Cake',
			},
		],
		itemQuantityShouldOverrideIngredientQuantity: true,
		itemPackageSizeShouldOverrideIngredientPackageSize: true,
		productUpc: '012345678905',
		manualSortIndex: 7,
		deprecatedQuantity: '2 cups',
		...overrides,
	});
	return protobuf.ListItem.decode(item.toBuffer());
}

function makeItem(i) {
	return new Item(i, { client: {}, protobuf, uid: 'user-1' });
}

// Encode to bytes and back, as the server would see it.
function wire(item) {
	return protobuf.ListItem.decode(item._encode().toBuffer()).toRaw();
}

describe('Item._encode (offline)', function() {
	it('round-trips every field of an unmodified decoded item', function() {
		const decoded = decodedListItem();
		expect(wire(makeItem(decoded))).to.deep.equal(decoded.toRaw());
	});

	it('keeps unmanaged fields when managed fields change', function() {
		const decoded = decodedListItem();
		const item = makeItem(decoded);
		item.checked = true;
		item.name = 'bread flour';
		item.details = 'organic';
		item.categoryMatchId = 'other';
		item._storeIds = ['store-2'];
		item._categoryAssignments = [{ identifier: 'ca-2', categoryGroupId: 'group-2', categoryId: 'cat-2' }];

		const expected = {
			...decoded.toRaw(),
			checked: true,
			name: 'bread flour',
			details: 'organic',
			categoryMatchId: 'other',
			storeIds: ['store-2'],
			categoryAssignments: [{ identifier: 'ca-2', categoryGroupId: 'group-2', categoryId: 'cat-2' }],
		};
		expect(wire(item)).to.deep.equal(expected);
	});

	it('rebuilds quantityPb and clears deprecatedQuantity when quantity changes', function() {
		const item = makeItem(decodedListItem());
		item.quantity = '3 lb';

		const out = wire(item);
		expect(out.quantityPb).to.deep.equal({ amount: '3', unit: 'lb', rawQuantity: '3 lb' });
		expect(out.deprecatedQuantity).to.equal(null);
		expect(out.recipeId).to.equal('recipe-1');
		expect(out.ingredients).to.have.length(2);
	});

	it('clears the quantity when set to an empty string', function() {
		const item = makeItem(decodedListItem());
		item.quantity = '';

		const out = wire(item);
		expect(out.quantityPb).to.equal(null);
		expect(out.deprecatedQuantity).to.equal(null);
	});

	it('keeps the decoded quantityPb split when quantity is unchanged', function() {
		const decoded = decodedListItem({ quantityPb: { amount: '1/2', unit: 'tsp', rawQuantity: '½ tsp' } });
		const item = makeItem(decoded);
		item.checked = true;

		expect(wire(item).quantityPb).to.deep.equal({ amount: '1/2', unit: 'tsp', rawQuantity: '½ tsp' });
	});

	it('encodes plain createItem() objects as before', function() {
		const item = makeItem({ name: 'TEST_Plain', quantity: '5 kg', notAField: true });

		const out = wire(item);
		expect(out.name).to.equal('TEST_Plain');
		expect(out.quantityPb).to.deep.equal({ amount: '5', unit: 'kg', rawQuantity: '5 kg' });
		expect(out.recipeId).to.equal(null);
		expect(out.ingredients).to.deep.equal([]);
		expect(out.identifier).to.be.a('string').and.not.empty;
	});

	it('exposes recipe-link fields read-only', function() {
		const item = makeItem(decodedListItem());

		expect(item.recipeId).to.equal('recipe-1');
		expect(item.rawIngredient).to.equal('2 cups flour');
		expect(item.eventId).to.equal('event-1');
		expect(item.ingredients.map(i => i.recipeName)).to.deep.equal(['Bread', 'Cake']);
		expect(item.ingredients[0].ingredient.note).to.equal('sifted');

		expect(() => { item.recipeId = 'x'; }).to.throw();
		expect(() => { item.rawIngredient = 'x'; }).to.throw();
		expect(() => { item.eventId = 'x'; }).to.throw();
		expect(() => { item.ingredients = []; }).to.throw();
	});

	it('returns empty recipe-link fields for plain items', function() {
		const item = makeItem({ name: 'TEST_Plain' });

		expect(item.recipeId).to.equal(undefined);
		expect(item.rawIngredient).to.equal(undefined);
		expect(item.eventId).to.equal(undefined);
		expect(item.ingredients).to.deep.equal([]);
	});
});
