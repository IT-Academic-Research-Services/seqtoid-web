// CZID-462 coverage: app/assets/src/components/views/PipelineViz/utils.ts
// inverseTransformDOMCoordinates undoes a CSS transform matrix on a point.
import { inverseTransformDOMCoordinates } from "../app/assets/src/components/views/PipelineViz/utils";

const mockTransform = (value: string) => {
  jest.spyOn(window, "getComputedStyle").mockReturnValue({
    getPropertyValue: () => value,
  } as $TSFixMe);
};

describe("PipelineViz/utils inverseTransformDOMCoordinates", () => {
  afterEach(() => jest.restoreAllMocks());

  it("returns the point unchanged for the identity matrix", () => {
    mockTransform("matrix(1, 0, 0, 1, 0, 0)");
    expect(inverseTransformDOMCoordinates({}, 5, 7)).toEqual({ x: 5, y: 7 });
  });

  it("inverts a uniform scale transform", () => {
    // A 2x scale maps screen coords back to half in each axis.
    mockTransform("matrix(2, 0, 0, 2, 0, 0)");
    const result = inverseTransformDOMCoordinates({}, 10, 20);
    expect(result.x).toBeCloseTo(5);
    expect(result.y).toBeCloseTo(10);
  });
});
