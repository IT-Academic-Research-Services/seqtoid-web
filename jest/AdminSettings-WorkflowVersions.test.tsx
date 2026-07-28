// Coverage for
// app/assets/src/components/views/AdminSettings/components/WorkflowVersions/WorkflowVersions.tsx
//
// One form per workflow app-config row. The component's own logic is
// handleSetWorkflows: it must suppress the native form redirect, read the
// workflow key out of the first field and the (editable) version out of the
// second, forward both to setWorkflowVersion, and surface the returned status
// in the shared status line. The submit label is derived by stripping the
// "-version" suffix off the config key.
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { WorkflowVersions } from "~/components/views/AdminSettings/components/WorkflowVersions/WorkflowVersions";

const mockSetWorkflowVersion = jest.fn();
jest.mock("~/api/index", () => ({
  setWorkflowVersion: (...args: $TSFixMe[]) => mockSetWorkflowVersion(...args),
}));

const workflowVersions = [
  { key: "consensus-genome-version", value: "3.4.5" },
  { key: "short-read-mngs-version", value: "8.0.1" },
];

const versionField = (formIndex: number) =>
  (screen.getAllByRole("textbox") as HTMLTextAreaElement[])[formIndex * 2 + 1];

// The handler reads its fields positionally (`event.target[0]` /
// `event.target[1]`). Browsers expose those indexed properties on a form via
// the HTMLFormElement indexed-property getter; jsdom implements
// `form.elements` but not the indexed getter, so mirror it here. This restores
// a real browser behaviour rather than substituting for the component.
const withIndexedElements = (form: HTMLFormElement) => {
  Array.from(form.elements).forEach((el, i) => {
    Object.defineProperty(form, String(i), { value: el, configurable: true });
  });
  return form;
};

const formAt = (container: HTMLElement, index: number) =>
  withIndexedElements(
    container.querySelectorAll("form")[index] as HTMLFormElement,
  );

describe("WorkflowVersions", () => {
  beforeEach(() => {
    mockSetWorkflowVersion.mockReset();
    mockSetWorkflowVersion.mockResolvedValue({ status: "success" });
  });

  it("renders one form per workflow, seeded with its key and version", () => {
    render(<WorkflowVersions workflowVersions={workflowVersions} />);
    const boxes = screen.getAllByRole("textbox") as HTMLTextAreaElement[];
    expect(boxes).toHaveLength(4);
    expect(boxes[0].value).toBe("consensus-genome-version");
    expect(boxes[0].readOnly).toBe(true);
    expect(boxes[1].value).toBe("3.4.5");
    expect(boxes[1].readOnly).toBe(false);
    expect(boxes[2].value).toBe("short-read-mngs-version");
    expect(boxes[3].value).toBe("8.0.1");
  });

  it("labels each submit button with the key minus the -version suffix", () => {
    render(<WorkflowVersions workflowVersions={workflowVersions} />);
    expect(screen.getByDisplayValue("Update consensus-genome")).toBeTruthy();
    expect(screen.getByDisplayValue("Update short-read-mngs")).toBeTruthy();
  });

  it("renders no forms and an empty status line for an empty list", () => {
    const { container } = render(<WorkflowVersions workflowVersions={[]} />);
    expect(container.querySelectorAll("form")).toHaveLength(0);
    expect(screen.getByText("Set Workflow Versions")).toBeTruthy();
    expect((container.querySelector("span") as HTMLElement).textContent).toBe(
      "",
    );
  });

  it("submits the edited version for the right workflow and shows the status", async () => {
    const { container } = render(
      <WorkflowVersions workflowVersions={workflowVersions} />,
    );
    fireEvent.change(versionField(1), { target: { value: "9.9.9" } });
    fireEvent.submit(formAt(container, 1));

    await waitFor(() =>
      expect(mockSetWorkflowVersion).toHaveBeenCalledWith(
        "short-read-mngs-version",
        "9.9.9",
      ),
    );
    await waitFor(() => expect(screen.getByText("success")).toBeTruthy());
    // Only the submitted form's workflow was sent.
    expect(mockSetWorkflowVersion).toHaveBeenCalledTimes(1);
  });

  it("prevents the default form redirect on submit", async () => {
    const { container } = render(
      <WorkflowVersions workflowVersions={workflowVersions} />,
    );
    const submitEvent = new Event("submit", {
      bubbles: true,
      cancelable: true,
    });
    fireEvent(formAt(container, 0), submitEvent);
    expect(submitEvent.defaultPrevented).toBe(true);
    // Let the awaited API call settle so the status write-back happens inside
    // the test rather than after it.
    await waitFor(() => expect(screen.getByText("success")).toBeTruthy());
  });

  it("replaces the status line when a second submit returns a new status", async () => {
    const { container } = render(
      <WorkflowVersions workflowVersions={workflowVersions} />,
    );
    fireEvent.submit(formAt(container, 0));
    await waitFor(() => expect(screen.getByText("success")).toBeTruthy());

    mockSetWorkflowVersion.mockResolvedValue({ status: "unprocessable" });
    fireEvent.submit(formAt(container, 0));
    await waitFor(() => expect(screen.getByText("unprocessable")).toBeTruthy());
    expect(screen.queryByText("success")).toBeNull();
  });
});
