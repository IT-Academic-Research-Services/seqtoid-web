// Coverage: app/assets/src/components/common/ProjectCreationModal.tsx
//
// ProjectCreationModal is a controlled form: name / access-level / description
// gate a Create button (disabled until all three are set), a More/Less-Info
// toggle reveals the description guidance, and Create calls the createProject
// API and routes success to onCreate and the two error shapes to an inline
// message. Only the createProject API is stubbed; the SDS + local inputs render
// for real so every branch of the enable/create/error logic is exercised.
import { fireEvent, render, screen, waitFor } from "@testing-library/react";

const mockCreateProject = jest.fn();

jest.mock("~/api", () => ({
  __esModule: true,
  createProject: (...args: $TSFixMe[]) => mockCreateProject(...args),
}));

import ProjectCreationModal from "~/components/common/ProjectCreationModal";

const renderModal = (props: $TSFixMe = {}) => {
  const onCancel = props.onCancel || jest.fn();
  const onCreate = props.onCreate || jest.fn();
  const utils = render(
    <ProjectCreationModal
      modalOpen={true}
      onCancel={onCancel}
      onCreate={onCreate}
      {...props}
    />,
  );
  return { ...utils, onCancel, onCreate };
};

// Fills every required field so the Create button becomes enabled.
const fillValidForm = () => {
  fireEvent.change(screen.getByTestId("project-description"), {
    target: { value: "A meaningful description" },
  });
  // Name input is the first text Input; grab it via role.
  const nameInput = document.querySelector(
    "input[type='text']",
  ) as HTMLInputElement;
  fireEvent.change(nameInput, { target: { value: "My Project" } });
  fireEvent.click(screen.getByTestId("private-project"));
};

beforeEach(() => {
  mockCreateProject.mockReset();
});

describe("ProjectCreationModal rendering", () => {
  it("renders the title, both sharing options and the create/cancel buttons", () => {
    renderModal();
    expect(screen.getByText("New Project")).toBeTruthy();
    expect(screen.getByTestId("public-project")).toBeTruthy();
    expect(screen.getByTestId("private-project")).toBeTruthy();
    expect(screen.getByTestId("create-project-btn")).toBeTruthy();
    expect(screen.getByTestId("cancel-btn")).toBeTruthy();
  });

  it("starts with the create button disabled until all fields are filled", () => {
    renderModal();
    expect(
      (screen.getByTestId("create-project-btn") as HTMLButtonElement).disabled,
    ).toBe(true);
    fillValidForm();
    expect(
      (screen.getByTestId("create-project-btn") as HTMLButtonElement).disabled,
    ).toBe(false);
  });
});

describe("ProjectCreationModal info toggle", () => {
  it("toggles the description guidance panel and its label", () => {
    renderModal();
    const toggle = screen.getByTestId("more-less-info-btn");
    expect(toggle.textContent).toBe("More Info");
    expect(screen.queryByTestId("project-description-info")).toBeNull();

    fireEvent.click(toggle);
    expect(toggle.textContent).toBe("Less Info");
    expect(screen.getByTestId("project-description-info")).toBeTruthy();

    fireEvent.click(toggle);
    expect(toggle.textContent).toBe("More Info");
    expect(screen.queryByTestId("project-description-info")).toBeNull();
  });
});

describe("ProjectCreationModal cancel", () => {
  it("calls onCancel when the cancel button is clicked", () => {
    const onCancel = jest.fn();
    renderModal({ onCancel });
    fireEvent.click(screen.getByTestId("cancel-btn"));
    expect(onCancel).toHaveBeenCalled();
  });
});

describe("ProjectCreationModal create flow", () => {
  it("creates the project and forwards the result to onCreate", async () => {
    const newProject = { id: 42, name: "My Project" };
    mockCreateProject.mockResolvedValue(newProject);
    const onCreate = jest.fn();
    renderModal({ onCreate });

    fillValidForm();
    fireEvent.click(screen.getByTestId("create-project-btn"));

    await waitFor(() => expect(onCreate).toHaveBeenCalledWith(newProject));
    expect(mockCreateProject).toHaveBeenCalledWith({
      name: "My Project",
      public_access: 0,
      description: "A meaningful description",
    });
  });

  it("shows the name-taken message when the API rejects with that error", async () => {
    mockCreateProject.mockRejectedValue(["Name has already been taken"]);
    const onCreate = jest.fn();
    renderModal({ onCreate });

    fillValidForm();
    fireEvent.click(screen.getByTestId("create-project-btn"));

    await waitFor(() =>
      expect(
        screen.getByText(
          "This project name is already taken. Please enter another name.",
        ),
      ).toBeTruthy(),
    );
    expect(onCreate).not.toHaveBeenCalled();
  });

  it("shows a generic error for any other API failure", async () => {
    mockCreateProject.mockRejectedValue(["Some other backend error"]);
    renderModal();

    fillValidForm();
    fireEvent.click(screen.getByTestId("create-project-btn"));

    await waitFor(() =>
      expect(
        screen.getByText("There was an error creating your project."),
      ).toBeTruthy(),
    );
  });

  it("selects the public access level via the public sharing option", async () => {
    const newProject = { id: 7 };
    mockCreateProject.mockResolvedValue(newProject);
    renderModal();

    fireEvent.change(screen.getByTestId("project-description"), {
      target: { value: "desc" },
    });
    const nameInput = document.querySelector(
      "input[type='text']",
    ) as HTMLInputElement;
    fireEvent.change(nameInput, { target: { value: "Public One" } });
    fireEvent.click(screen.getByTestId("public-project"));

    fireEvent.click(screen.getByTestId("create-project-btn"));
    await waitFor(() =>
      expect(mockCreateProject).toHaveBeenCalledWith(
        expect.objectContaining({ public_access: 1 }),
      ),
    );
  });
});
