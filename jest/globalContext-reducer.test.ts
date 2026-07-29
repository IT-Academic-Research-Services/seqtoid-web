// Coverage: app/assets/src/globalContext/reducer.ts
//
// A tiny action creator plus a one-case reducer. Both sides of the switch are
// exercised here: the handled UPDATE_DISCOVERY_PROJECT_IDS case (including the
// null / scalar / array payload shapes the state type allows) and the default
// branch, which throws rather than silently returning state.
import { GlobalContextStateType } from "~/globalContext/initialState";
import {
  ActionType,
  createAction,
  globalContextReducer,
} from "~/globalContext/reducer";

const baseState = (): GlobalContextStateType => ({
  discoveryProjectIds: null,
});

describe("createAction", () => {
  it("packages the type and payload into a plain action object", () => {
    expect(
      createAction(ActionType.UPDATE_DISCOVERY_PROJECT_IDS, [1, 2, 3]),
    ).toEqual({
      type: ActionType.UPDATE_DISCOVERY_PROJECT_IDS,
      payload: [1, 2, 3],
    });
  });

  it("preserves a null payload rather than dropping the key", () => {
    const action = createAction(ActionType.UPDATE_DISCOVERY_PROJECT_IDS, null);
    expect(action.payload).toBeNull();
    expect(Object.keys(action).sort()).toEqual(["payload", "type"]);
  });
});

describe("globalContextReducer", () => {
  it("writes an array payload to discoveryProjectIds", () => {
    const state = baseState();
    const next = globalContextReducer(
      state,
      createAction(ActionType.UPDATE_DISCOVERY_PROJECT_IDS, [7, 8]),
    );

    expect(next.discoveryProjectIds).toEqual([7, 8]);
    // The reducer must not mutate the state it was handed.
    expect(next).not.toBe(state);
    expect(state.discoveryProjectIds).toBeNull();
  });

  it("writes a single numeric project id", () => {
    const next = globalContextReducer(
      baseState(),
      createAction(ActionType.UPDATE_DISCOVERY_PROJECT_IDS, 42),
    );
    expect(next.discoveryProjectIds).toBe(42);
  });

  it("clears the ids when the payload is null", () => {
    const next = globalContextReducer(
      { discoveryProjectIds: [1, 2] },
      createAction(ActionType.UPDATE_DISCOVERY_PROJECT_IDS, null),
    );
    expect(next.discoveryProjectIds).toBeNull();
  });

  it("carries unrelated state keys through untouched", () => {
    const state = {
      discoveryProjectIds: null,
      somethingElse: "keep me",
    } as unknown as GlobalContextStateType;
    const next = globalContextReducer(
      state,
      createAction(ActionType.UPDATE_DISCOVERY_PROJECT_IDS, 5),
    ) as unknown as Record<string, unknown>;

    expect(next.somethingElse).toBe("keep me");
  });

  it("throws a descriptive error for an unknown action type", () => {
    expect(() =>
      globalContextReducer(baseState(), {
        type: "NOT_A_REAL_ACTION",
        payload: null,
      } as unknown as ReturnType<typeof createAction>),
    ).toThrow(
      "globalContextReducer cannot handle action type: NOT_A_REAL_ACTION",
    );
  });
});
