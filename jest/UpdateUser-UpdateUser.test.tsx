// Coverage for app/assets/src/components/views/UpdateUser/UpdateUser.tsx
//
// UpdateUser owns all of the admin "edit a user" state: it seeds the form from
// the selected user, tracks the archetype/segment checkboxes, validates the
// email, serialises the two checkbox groups into JSON before calling the API,
// and handles both the success and the failure of that call.
//
// The real UserForm is rendered (not stubbed) so the wiring between the two is
// covered as well; only the API call and the post-save navigation are mocked,
// since those leave the process.
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import React from "react";
import { updateUser } from "~/api/user";
import UpdateUser from "~/components/views/UpdateUser/UpdateUser";
import { openUrl } from "~utils/links";

jest.mock("~/api/user", () => ({
  updateUser: jest.fn(),
}));

jest.mock("~utils/links", () => ({
  openUrl: jest.fn(),
}));

// Keeps prettier's organize-imports from dropping the React import that the
// classic JSX runtime needs in scope.
const _React: typeof React = React;

const mockedUpdateUser = updateUser as jest.Mock;
const mockedOpenUrl = openUrl as jest.Mock;

// UserForm renders its checkboxes in a fixed order; indexing into them is more
// robust than matching on label text, which collides ("Admin" is both a section
// header and a checkbox label).
const CHECKBOX_ORDER = [
  "Medical Detective",
  "Landscape Explorer",
  "Outbreak Surveyor",
  "Microbiome Investigator",
  "DPH",
  "GCE",
  "Africa CDC",
  "Biohub",
  "LMIC",
  "Admin",
] as const;

function checkboxes(container: HTMLElement) {
  return Array.from(
    container.querySelectorAll<HTMLInputElement>('input[type="checkbox"]'),
  );
}

function toggle(
  container: HTMLElement,
  label: (typeof CHECKBOX_ORDER)[number],
) {
  const index = CHECKBOX_ORDER.indexOf(label);
  fireEvent.click(checkboxes(container)[index]);
}

function isChecked(
  container: HTMLElement,
  label: (typeof CHECKBOX_ORDER)[number],
) {
  return checkboxes(container)[CHECKBOX_ORDER.indexOf(label)].checked;
}

function typeInto(placeholder: string, value: string) {
  fireEvent.change(screen.getByPlaceholderText(placeholder), {
    target: { value },
  });
}

const EXISTING_USER = {
  id: 42,
  email: "someone@example.com",
  name: "Some One",
  institution: "UCSF",
  admin: true,
  archetypes: '["Medical Detective","Outbreak Surveyor"]',
  segments: '["DPH","LMIC"]',
};

beforeEach(() => {
  jest.clearAllMocks();
  mockedUpdateUser.mockResolvedValue({});
});

describe("views/UpdateUser", () => {
  describe("seeding from the selected user", () => {
    it("prefills the text fields from the selected user", () => {
      render(<UpdateUser selectedUser={EXISTING_USER} />);
      expect(
        (screen.getByPlaceholderText("Email") as HTMLInputElement).value,
      ).toBe("someone@example.com");
      expect(
        (screen.getByPlaceholderText("Name") as HTMLInputElement).value,
      ).toBe("Some One");
      expect(
        (screen.getByPlaceholderText("Institution") as HTMLInputElement).value,
      ).toBe("UCSF");
    });

    it("checks exactly the archetypes, segments and admin flag the user has", () => {
      const { container } = render(<UpdateUser selectedUser={EXISTING_USER} />);
      expect(isChecked(container, "Medical Detective")).toBe(true);
      expect(isChecked(container, "Outbreak Surveyor")).toBe(true);
      expect(isChecked(container, "Landscape Explorer")).toBe(false);
      expect(isChecked(container, "Microbiome Investigator")).toBe(false);
      expect(isChecked(container, "DPH")).toBe(true);
      expect(isChecked(container, "LMIC")).toBe(true);
      expect(isChecked(container, "GCE")).toBe(false);
      expect(isChecked(container, "Africa CDC")).toBe(false);
      expect(isChecked(container, "Biohub")).toBe(false);
      expect(isChecked(container, "Admin")).toBe(true);
    });

    it("renders an empty, all-unchecked form when there is no selected user", () => {
      const { container } = render(<UpdateUser />);
      expect(
        (screen.getByPlaceholderText("Email") as HTMLInputElement).value,
      ).toBe("");
      expect(
        (screen.getByPlaceholderText("Name") as HTMLInputElement).value,
      ).toBe("");
      expect(checkboxes(container).every(box => !box.checked)).toBe(true);
    });

    it("treats a user with no admin flag as a non-admin", () => {
      const { container } = render(
        <UpdateUser selectedUser={{ email: "a@b.com" }} />,
      );
      expect(isChecked(container, "Admin")).toBe(false);
    });

    it("always offers the back and home links", () => {
      render(<UpdateUser selectedUser={EXISTING_USER} />);
      expect(screen.getByText("Back").getAttribute("href")).toBe("/users");
      expect(screen.getByText("Home").getAttribute("href")).toBe("/");
    });
  });

  describe("validation", () => {
    it("rejects an empty email and does not call the API", () => {
      render(<UpdateUser />);
      fireEvent.click(screen.getByText("Submit"));

      expect(
        screen.getByText("Please enter valid email address"),
      ).not.toBeNull();
      expect(mockedUpdateUser).not.toHaveBeenCalled();
    });

    it("rejects an email that has been cleared out", () => {
      render(<UpdateUser selectedUser={EXISTING_USER} />);
      typeInto("Email", "");
      fireEvent.click(screen.getByText("Submit"));

      expect(
        screen.getByText("Please enter valid email address"),
      ).not.toBeNull();
      expect(mockedUpdateUser).not.toHaveBeenCalled();
    });

    it("shows no error message before anything is submitted", () => {
      render(<UpdateUser />);
      expect(screen.queryByText("Please enter valid email address")).toBeNull();
    });
  });

  describe("checkbox state", () => {
    it("toggles an archetype on and back off", () => {
      const { container } = render(<UpdateUser />);
      toggle(container, "Landscape Explorer");
      expect(isChecked(container, "Landscape Explorer")).toBe(true);
      toggle(container, "Landscape Explorer");
      expect(isChecked(container, "Landscape Explorer")).toBe(false);
    });

    it("toggles a segment and the admin flag independently", () => {
      const { container } = render(<UpdateUser selectedUser={EXISTING_USER} />);
      toggle(container, "Biohub");
      toggle(container, "Admin");
      expect(isChecked(container, "Biohub")).toBe(true);
      expect(isChecked(container, "Admin")).toBe(false);
      // Nothing else moved.
      expect(isChecked(container, "DPH")).toBe(true);
    });
  });

  describe("submitting", () => {
    it("sends the edited fields, serialising archetypes and segments as JSON", async () => {
      const { container } = render(<UpdateUser selectedUser={EXISTING_USER} />);
      typeInto("Email", "new@example.com");
      typeInto("Name", "New Name");
      typeInto("Institution", "Biohub");
      // Add one of each group and drop one of each.
      toggle(container, "Landscape Explorer");
      toggle(container, "Outbreak Surveyor");
      toggle(container, "Africa CDC");
      toggle(container, "LMIC");

      fireEvent.click(screen.getByText("Submit"));

      await waitFor(() => expect(mockedUpdateUser).toHaveBeenCalledTimes(1));
      expect(mockedUpdateUser).toHaveBeenCalledWith({
        userId: 42,
        name: "New Name",
        email: "new@example.com",
        institution: "Biohub",
        isAdmin: true,
        // Serialised in the component's own fixed order, not click order.
        archetypes: '["Medical Detective","Landscape Explorer"]',
        segments: '["Africa CDC","DPH"]',
      });
    });

    it("sends empty JSON arrays when nothing is selected", async () => {
      render(<UpdateUser />);
      typeInto("Email", "blank@example.com");
      fireEvent.click(screen.getByText("Submit"));

      await waitFor(() => expect(mockedUpdateUser).toHaveBeenCalledTimes(1));
      expect(mockedUpdateUser).toHaveBeenCalledWith(
        expect.objectContaining({
          userId: null,
          isAdmin: false,
          archetypes: "[]",
          segments: "[]",
        }),
      );
    });

    it("sends every archetype and segment when all are selected", async () => {
      const { container } = render(<UpdateUser />);
      typeInto("Email", "all@example.com");
      CHECKBOX_ORDER.forEach(label => toggle(container, label));
      fireEvent.click(screen.getByText("Submit"));

      await waitFor(() => expect(mockedUpdateUser).toHaveBeenCalledTimes(1));
      expect(mockedUpdateUser).toHaveBeenCalledWith(
        expect.objectContaining({
          isAdmin: true,
          archetypes:
            '["Medical Detective","Landscape Explorer","Outbreak Surveyor","Microbiome Investigator"]',
          segments: '["Africa CDC","Biohub","DPH","GCE","LMIC"]',
        }),
      );
    });

    it("reports success and navigates back to the user list", async () => {
      render(<UpdateUser selectedUser={EXISTING_USER} />);
      fireEvent.click(screen.getByText("Submit"));

      await waitFor(() =>
        expect(screen.getByText("User updated successfully")).not.toBeNull(),
      );
      expect(mockedOpenUrl).toHaveBeenCalledWith("/users");
      // The spinner is gone once the save resolves.
      expect(screen.getByText("Submit")).not.toBeNull();
    });

    it("keeps the user on the page and surfaces nothing new when the API fails", async () => {
      mockedUpdateUser.mockRejectedValue({
        data: ["Email has already been taken"],
      });
      const { container } = render(<UpdateUser selectedUser={EXISTING_USER} />);
      fireEvent.click(screen.getByText("Submit"));

      // The failed save leaves the form in its submitting state, so the submit
      // button is replaced by the spinner and no navigation happens.
      await waitFor(() =>
        expect(container.querySelector(".fa-spinner")).not.toBeNull(),
      );
      expect(mockedOpenUrl).not.toHaveBeenCalled();
      expect(screen.queryByText("User updated successfully")).toBeNull();
      expect(screen.queryByText("Submit")).toBeNull();
    });
  });
});
