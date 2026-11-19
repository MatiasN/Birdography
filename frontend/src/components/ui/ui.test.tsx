// The shadcn components are our code once copied (plan 0007 §4), so they are held to the same 100% gate. Pages
// cover how they're used; these tests reach the parts and variants no page does. Parts nothing used were removed
// (plan 0008 §3); `npx shadcn@<version> add` brings them back when a page needs them.
import { render, screen } from "@testing-library/react";
import { useState } from "react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { Alert, AlertTitle } from "@/components/ui/alert";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Sheet, SheetContent, SheetTitle } from "@/components/ui/sheet";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";

describe("Button", () => {
  it("renders a button with its variant and size", async () => {
    const onClick = vi.fn<() => void>();
    render(
      <Button variant="outline" size="icon" aria-label="Close" onClick={onClick}>
        x
      </Button>,
    );
    const button = screen.getByRole("button", { name: "Close" });
    expect(button).toHaveAttribute("data-variant", "outline");
    expect(button).toHaveAttribute("data-size", "icon");
    await userEvent.click(button);
    expect(onClick).toHaveBeenCalledOnce();
  });

  it("defaults to the primary variant", () => {
    render(<Button>Save</Button>);
    expect(screen.getByRole("button", { name: "Save" })).toHaveAttribute("data-variant", "default");
  });

  it("can render its child instead, such as a link", () => {
    render(
      <Button asChild>
        <a href="/catalogue">Catalogue</a>
      </Button>,
    );
    expect(screen.getByRole("link", { name: "Catalogue" })).toHaveAttribute("data-slot", "button");
  });
});

describe("Badge", () => {
  it("renders a span or its child", () => {
    render(
      <>
        <Badge variant="outline">Coming</Badge>
        <Badge>Plain</Badge>
        <Badge asChild>
          <a href="/x">Linked</a>
        </Badge>
      </>,
    );
    expect(screen.getByText("Coming")).toHaveAttribute("data-variant", "outline");
    expect(screen.getByText("Plain")).toHaveAttribute("data-variant", "outline"); // the only variant left
    expect(screen.getByRole("link", { name: "Linked" })).toHaveAttribute("data-slot", "badge");
  });
});

describe("Card", () => {
  it("renders every part", () => {
    render(
      <>
        <Card>
          <CardHeader>
            <CardTitle>Password</CardTitle>
            <CardDescription>At least 10 characters</CardDescription>
          </CardHeader>
          <CardContent>body</CardContent>
        </Card>
        <Card size="sm">small</Card>
      </>,
    );
    for (const text of ["Password", "At least 10 characters", "body"]) {
      expect(screen.getByText(text)).toBeInTheDocument();
    }
    expect(screen.getByText("small")).toHaveAttribute("data-size", "sm");
  });
});

describe("Input and Label", () => {
  it("label the input", async () => {
    render(
      <>
        <Label htmlFor="email">Email</Label>
        <Input id="email" type="email" />
      </>,
    );
    await userEvent.type(screen.getByLabelText("Email"), "a@b.c");
    expect(screen.getByLabelText("Email")).toHaveValue("a@b.c");
  });
});

describe("Alert", () => {
  it("renders every part and variant", () => {
    render(
      <>
        <Alert variant="destructive">
          <AlertTitle>Could not save</AlertTitle>
        </Alert>
        <Alert>plain</Alert>
      </>,
    );
    expect(screen.getAllByRole("alert")).toHaveLength(2);
    expect(screen.getByText("Could not save")).toBeInTheDocument();
  });
});

describe("Avatar", () => {
  it("shows the fallback initial in each size", () => {
    render(
      <>
        <Avatar size="lg">
          <AvatarFallback>M</AvatarFallback>
        </Avatar>
        <Avatar>
          <AvatarFallback>A</AvatarFallback>
        </Avatar>
      </>,
    );
    expect(screen.getByText("M")).toBeInTheDocument();
    expect(screen.getByText("A")).toBeInTheDocument();
  });
});

describe("ToggleGroup", () => {
  it("passes the group's variant and size to its items, or uses their own", async () => {
    render(
      <>
        <ToggleGroup type="single" variant="outline" size="sm" spacing={0} aria-label="styled">
          <ToggleGroupItem value="a">A</ToggleGroupItem>
        </ToggleGroup>
        <ToggleGroup type="single" aria-label="plain">
          <ToggleGroupItem value="b" variant="outline" size="lg">
            B
          </ToggleGroupItem>
        </ToggleGroup>
      </>,
    );
    expect(screen.getByRole("radio", { name: "A" })).toHaveAttribute("data-variant", "outline");
    expect(screen.getByRole("radio", { name: "A" })).toHaveAttribute("data-size", "sm");
    expect(screen.getByRole("radio", { name: "B" })).toHaveAttribute("data-size", "lg");
    await userEvent.click(screen.getByRole("radio", { name: "B" }));
    expect(screen.getByRole("radio", { name: "B" })).toBeChecked();
  });
});

describe("DropdownMenu", () => {
  it("opens from its trigger and runs an item", async () => {
    const onSelect = vi.fn<() => void>();
    render(
      <DropdownMenu>
        <DropdownMenuTrigger>Account</DropdownMenuTrigger>
        <DropdownMenuContent>
          <DropdownMenuItem onSelect={onSelect}>Profile</DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>,
    );
    await userEvent.click(screen.getByRole("button", { name: "Account" }));
    await userEvent.click(await screen.findByRole("menuitem", { name: "Profile" }));
    expect(onSelect).toHaveBeenCalledOnce();
    expect(screen.queryByRole("menu")).not.toBeInTheDocument();
  });

  it("renders a label, an inset destructive item and a separator", () => {
    render(
      <DropdownMenu open>
        <DropdownMenuTrigger>Menu</DropdownMenuTrigger>
        <DropdownMenuContent>
          <DropdownMenuLabel inset>Signed in</DropdownMenuLabel>
          <DropdownMenuSeparator />
          <DropdownMenuItem inset variant="destructive">
            Log out
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>,
    );
    expect(screen.getByText("Signed in")).toBeInTheDocument();
    expect(screen.getByRole("menuitem", { name: "Log out" })).toHaveAttribute("data-variant", "destructive");
  });
});

/** Opens the sheet from a plain button and unmounts it on close, as ResponsivePanel does. */
function Opener() {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button onClick={() => setOpen(true)}>Open photo</button>
      {open && (
        <Sheet open onOpenChange={setOpen}>
          <SheetContent side="bottom" aria-describedby={undefined}>
            <SheetTitle>Common kingfisher</SheetTitle>
          </SheetContent>
        </Sheet>
      )}
    </>
  );
}

describe("Sheet", () => {
  it("opens as a dialog, closes with its built-in button", async () => {
    render(<Opener />);
    await userEvent.click(screen.getByRole("button", { name: "Open photo" }));
    const dialog = await screen.findByRole("dialog", { name: "Common kingfisher" });
    expect(dialog).toHaveAttribute("data-side", "bottom");

    await userEvent.click(screen.getByRole("button", { name: "Close" })); // the built-in close button
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("closes with Escape and can leave out the close button", async () => {
    const onOpenChange = vi.fn<(open: boolean) => void>();
    render(
      <Sheet open onOpenChange={onOpenChange}>
        <SheetContent showCloseButton={false} aria-describedby={undefined}>
          <SheetTitle>Panel</SheetTitle>
        </SheetContent>
      </Sheet>,
    );
    expect(screen.getByRole("dialog")).toHaveAttribute("data-side", "right");
    expect(screen.queryByRole("button", { name: "Close" })).not.toBeInTheDocument();
    await userEvent.keyboard("{Escape}");
    expect(onOpenChange).toHaveBeenCalledWith(false);
  });
});
