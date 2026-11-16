import { createTheme } from "@mantine/core";

export const flutterMantineTheme = createTheme({
  primaryColor: "cyan",
  // Matches the Rack type system in globals.css / DESIGN.md.
  fontFamily: "var(--font-plex-sans), ui-sans-serif, system-ui, sans-serif",
  fontFamilyMonospace: "var(--font-plex-mono), ui-monospace, SFMono-Regular, Menlo, monospace",
  headings: { fontFamily: "var(--font-barlow), var(--font-plex-sans), ui-sans-serif, sans-serif", fontWeight: "600" },
  // Small corners that vary by role: controls 3px, panels 4px. xl stays for pills.
  radius: { xs: "2px", sm: "3px", md: "3px", lg: "4px" },
  defaultRadius: "md",
  cursorType: "pointer",
  components: {
    Button: {
      defaultProps: { size: "sm" },
      styles: {
        root: {
          transition:
            "transform 160ms cubic-bezier(0.22, 1, 0.36, 1), box-shadow 160ms ease, background-color 160ms ease, color 160ms ease, filter 160ms ease",
        },
      },
    },
    // Floating layers: chassis surface, 6px corners, the one float shadow (DESIGN.md → Shape and depth).
    Popover: {
      defaultProps: { shadow: "none" },
      styles: {
        dropdown: {
          backgroundColor: "var(--card)",
          border: "none",
          borderRadius: "var(--radius-xl)",
          boxShadow: "var(--shadow-float)",
        },
      },
    },
    Menu: {
      defaultProps: { shadow: "none" },
      styles: {
        dropdown: {
          backgroundColor: "var(--card)",
          border: "none",
          borderRadius: "var(--radius-xl)",
          boxShadow: "var(--shadow-float)",
        },
      },
    },
    Combobox: {
      defaultProps: { shadow: "none" },
      styles: {
        dropdown: {
          backgroundColor: "var(--card)",
          border: "none",
          borderRadius: "var(--radius-xl)",
          boxShadow: "var(--shadow-float)",
        },
      },
    },
    TextInput: { defaultProps: { size: "sm" } },
    PasswordInput: { defaultProps: { size: "sm" } },
    NumberInput: { defaultProps: { size: "sm" } },
    Select: { defaultProps: { size: "sm" } },
    Switch: { defaultProps: { size: "sm" } },
    Tooltip: {
      defaultProps: {
        withArrow: true,
        arrowSize: 6,
        offset: 5,
      },
      styles: {
        tooltip: {
          "--tooltip-bg": "var(--card)",
          "--tooltip-color": "var(--foreground)",
          backgroundColor: "var(--card)",
          color: "var(--foreground)",
          border: "none",
          boxShadow: "none",
          fontSize: "12px",
          fontWeight: 500,
          filter:
            "drop-shadow(0 1px 0 var(--border)) drop-shadow(0 -1px 0 var(--border)) drop-shadow(1px 0 0 var(--border)) drop-shadow(-1px 0 0 var(--border)) drop-shadow(0 8px 16px rgb(0 0 0 / 0.45))",
        },
      },
    },
  },
});
