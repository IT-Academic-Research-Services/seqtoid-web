// Coverage for app/assets/src/components/views/DiscoveryView/DiscoveryDataLayer.ts
// These pin the defensive guards in ObjectCollectionView.fetchObjectRows, the
// async data-loading path behind the /my_data DiscoveryView. Sentry saw two
// crashes here when the fetch callback resolved with a null/undefined objects
// array (DEV-REACTJS-PROJECT-18) or with no ids so _orderedIds stayed null and
// the `in` check hit null (DEV-REACTJS-PROJECT-16 / -13).
import { DiscoveryDataLayer } from "../app/assets/src/components/views/DiscoveryView/DiscoveryDataLayer";

const makeView = (fetchResult: {
  fetchedObjects: unknown;
  fetchedObjectIds: unknown;
}) => {
  const dataLayer = new DiscoveryDataLayer("my_data");
  // Override the collection's fetch callback so no real API call is made.
  dataLayer.samples.fetchDataCallback = jest
    .fn()
    // @ts-expect-error test drives intentionally malformed payloads
    .mockResolvedValue(fetchResult);
  return dataLayer.samples.createView({
    conditions: {},
    pageSize: 10,
    onViewChange: jest.fn(),
    shouldConvertIdToString: false,
  });
};

describe("ObjectCollectionView.fetchObjectRows guards", () => {
  it("does not throw when the callback returns no fetchedObjects array (REACTJS-18)", async () => {
    const view = makeView({
      fetchedObjects: undefined,
      fetchedObjectIds: [1, 2],
    });
    await expect(
      view.fetchObjectRows({ startIndex: 0, stopIndex: 9 }),
    ).resolves.toBeDefined();
  });

  it("does not throw the `in`-on-null error when no ids are returned (REACTJS-16/-13)", async () => {
    const view = makeView({ fetchedObjects: [], fetchedObjectIds: null });
    await expect(
      view.fetchObjectRows({ startIndex: 0, stopIndex: 9 }),
    ).resolves.toEqual([]);
  });

  it("still returns the loaded rows on a well-formed payload", async () => {
    const view = makeView({
      fetchedObjects: [
        { id: 1, name: "a" },
        { id: 2, name: "b" },
      ],
      fetchedObjectIds: [1, 2],
    });
    const rows = await view.fetchObjectRows({ startIndex: 0, stopIndex: 9 });
    expect(rows).toEqual([
      { id: 1, name: "a" },
      { id: 2, name: "b" },
    ]);
  });
});
