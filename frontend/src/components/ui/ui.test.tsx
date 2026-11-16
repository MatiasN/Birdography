// The shadcn components are our code once copied (plan 0007 §4), so they are held to the same 100% gate. Pages
// cover how they're used; these tests reach every part and variant, including ones no page uses yet.
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { Alert, AlertAction, AlertDescription, AlertTitle } from "./alert";
import { Avatar, AvatarBadge, AvatarFallback, AvatarGroup, AvatarGroupCount, AvatarImage } from "./avatar";
import { Badge } from "./badge";
import { Button } from "./button";
import { Card, CardAction, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from "./card";
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuPortal,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuShortcut,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger,
} from "./dropdown-menu";
import { Input } from "./input";
import { Label } from "./label";
import {
  Sheet,
  SheetClose,
  SheetContent,
  SheetDescription,
  SheetFooter,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from "./sheet";
import { Toggle } from "./toggle";
import { ToggleGroup, ToggleGroupItem } from "./toggle-group";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "./tooltip";

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
    expect(screen.getByText("Plain")).toHaveAttribute("data-variant", "default");
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
            <CardAction>action</CardAction>
          </CardHeader>
          <CardContent>body</CardContent>
          <CardFooter>footer</CardFooter>
        </Card>
        <Card size="sm">small</Card>
      </>,
    );
    for (const text of ["Password", "At least 10 characters", "action", "body", "footer"]) {
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
          <AlertDescription>Try again</AlertDescription>
          <AlertAction>retry</AlertAction>
        </Alert>
        <Alert>plain</Alert>
      </>,
    );
    expect(screen.getAllByRole("alert")).toHaveLength(2);
    expect(screen.getByText("Could not save")).toBeInTheDocument();
    expect(screen.getByText("Try again")).toBeInTheDocument();
    expect(screen.getByText("retry")).toBeInTheDocument();
  });
});

describe("Avatar", () => {
  it("shows the fallback initial, badge and group", () => {
    render(
      <AvatarGroup>
        <Avatar size="lg">
          <AvatarImage src="" alt="" />
          <AvatarFallback>M</AvatarFallback>
          <AvatarBadge />
        </Avatar>
        <Avatar>
          <AvatarFallback>A</AvatarFallback>
        </Avatar>
        <AvatarGroupCount>+3</AvatarGroupCount>
      </AvatarGroup>,
    );
    expect(screen.getByText("M")).toBeInTheDocument();
    expect(screen.getByText("+3")).toBeInTheDocument();
  });
});

describe("Toggle and ToggleGroup", () => {
  it("toggles on its own", async () => {
    render(<Toggle aria-label="Bold">B</Toggle>);
    await userEvent.click(screen.getByRole("button", { name: "Bold" }));
    expect(screen.getByRole("button", { name: "Bold" })).toHaveAttribute("aria-pressed", "true");
  });

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

describe("Tooltip", () => {
  it("shows its content on hover", async () => {
    render(
      <TooltipProvider>
        <Tooltip>
          <TooltipTrigger>Map</TooltipTrigger>
          <TooltipContent>Photos on the map</TooltipContent>
        </Tooltip>
      </TooltipProvider>,
    );
    await userEvent.hover(screen.getByText("Map"));
    expect(await screen.findByRole("tooltip")).toHaveTextContent("Photos on the map");
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

  it("renders every part", () => {
    render(
      <DropdownMenu open>
        <DropdownMenuTrigger>Menu</DropdownMenuTrigger>
        <DropdownMenuPortal>
          <DropdownMenuContent>
            <DropdownMenuLabel inset>Signed in</DropdownMenuLabel>
            <DropdownMenuGroup>
              <DropdownMenuItem inset variant="destructive">
                Log out
                <DropdownMenuShortcut>⌘Q</DropdownMenuShortcut>
              </DropdownMenuItem>
            </DropdownMenuGroup>
            <DropdownMenuSeparator />
            <DropdownMenuCheckboxItem checked inset>
              Show captions
            </DropdownMenuCheckboxItem>
            <DropdownMenuRadioGroup value="grid">
              <DropdownMenuRadioItem value="grid" inset>
                Grid
              </DropdownMenuRadioItem>
            </DropdownMenuRadioGroup>
            <DropdownMenuSub open>
              <DropdownMenuSubTrigger inset>More</DropdownMenuSubTrigger>
              <DropdownMenuSubContent>
                <DropdownMenuItem>Nested</DropdownMenuItem>
              </DropdownMenuSubContent>
            </DropdownMenuSub>
          </DropdownMenuContent>
        </DropdownMenuPortal>
      </DropdownMenu>,
    );
    expect(screen.getByText("Signed in")).toBeInTheDocument();
    expect(screen.getByRole("menuitem", { name: /Log out/ })).toHaveAttribute("data-variant", "destructive");
    expect(screen.getByText("⌘Q")).toBeInTheDocument();
    expect(screen.getByRole("menuitemcheckbox", { name: "Show captions" })).toBeChecked();
    expect(screen.getByRole("menuitemradio", { name: "Grid" })).toBeChecked();
    expect(screen.getByRole("menuitem", { name: "Nested" })).toBeInTheDocument();
  });
});

describe("Sheet", () => {
  it("opens from its trigger, traps it as a dialog and closes", async () => {
    render(
      <Sheet>
        <SheetTrigger>Open photo</SheetTrigger>
        <SheetContent side="bottom">
          <SheetHeader>
            <SheetTitle>Common kingfisher</SheetTitle>
            <SheetDescription>Photo details</SheetDescription>
          </SheetHeader>
          <SheetFooter>
            <SheetClose>Done</SheetClose>
          </SheetFooter>
        </SheetContent>
      </Sheet>,
    );
    await userEvent.click(screen.getByRole("button", { name: "Open photo" }));
    const dialog = await screen.findByRole("dialog", { name: "Common kingfisher" });
    expect(dialog).toHaveAttribute("data-side", "bottom");
    expect(dialog).toHaveAccessibleDescription("Photo details");

    await userEvent.click(screen.getByRole("button", { name: "Close" })); // the built-in close button
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Open photo" })).toHaveFocus();

    await userEvent.click(screen.getByRole("button", { name: "Open photo" }));
    await userEvent.click(await screen.findByRole("button", { name: "Done" }));
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
