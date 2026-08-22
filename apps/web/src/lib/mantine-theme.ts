import { createTheme } from "@mantine/core";

export const flutterMantineTheme = createTheme({
  primaryColor: "cyan",
  fontFamily: "var(--font-geist-sans), ui-sans-serif, system-ui, sans-serif",
  fontFamilyMonospace: "var(--font-geist-mono), ui-monospace, SFMono-Regular, Menlo, monospace",
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
    TextInput: { defaultProps: { size: "sm" } },
    PasswordInput: { defaultProps: { size: "sm" } },
    NumberInput: { defaultProps: { size: "sm" } },
    Select: { defaultProps: { size: "sm" } },
    Switch: { defaultProps: { size: "sm" } },
  },
});
