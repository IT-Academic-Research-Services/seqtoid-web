/**
 * SMP-1500: Browser Back button shows upload completed dialog.
 *
 * After a sample upload finishes, leaving the flow via "Go to Project" must not
 * leave the completed upload wizard in browser history. If it does, pressing
 * browser Back restores the stale flow (from bfcache) still showing the
 * "upload complete" progress modal.
 *
 * The fix routes the post-upload redirect through location.replace instead of a
 * location.href assignment, so the completed flow is dropped from history and
 * Back returns to the page the user was on before the upload. These tests pin
 * that behavior: redirectToProject must call replace (not push a new entry via
 * href) and must target the correct project URL.
 */
import { redirectToProject } from "../app/assets/src/components/views/SampleUploadFlow/components/UploadProgressModal/upload_progress_utils";

describe("redirectToProject (SMP-1500 browser Back handling)", () => {
  const originalLocation = window.location;
  let replaceMock: jest.Mock;
  let hrefSetter: jest.Mock;

  beforeEach(() => {
    replaceMock = jest.fn();
    hrefSetter = jest.fn();

    // jsdom's window.location is not writable; redefine it with spies that let
    // us observe whether the code pushes a new history entry (href assignment)
    // or replaces the current one (replace).
    Object.defineProperty(window, "location", {
      configurable: true,
      value: {
        replace: replaceMock,
        get href() {
          return "http://localhost/samples/upload";
        },
        set href(value: string) {
          hrefSetter(value);
        },
      },
    });
  });

  afterEach(() => {
    Object.defineProperty(window, "location", {
      configurable: true,
      value: originalLocation,
    });
  });

  it("replaces the current history entry instead of pushing a new one", () => {
    redirectToProject("123");

    // Must use replace so the completed upload flow is dropped from history and
    // browser Back cannot land back on the "upload complete" dialog.
    expect(replaceMock).toHaveBeenCalledTimes(1);
    expect(hrefSetter).not.toHaveBeenCalled();
  });

  it("navigates to the given project's home view", () => {
    redirectToProject("456");

    expect(replaceMock).toHaveBeenCalledWith("/home?project_id=456");
  });
});
