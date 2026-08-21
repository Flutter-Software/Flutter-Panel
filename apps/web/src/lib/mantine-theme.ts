import { createTheme } from "@mantine/core";

export const flutterMantineTheme = createTheme({
  primaryColor: "cyan",
  fontFamily: "var(--font-geist-sans), ui-sans-serif, system-ui, sans-serif",
  fontFamilyMonospace: "var(--font-geist-mono), ui-monospace, SFMono-Regular, Menlo, monospace",
  defaultRadius: "md",
  cursorType: "pointer",
  components: {
    Button: { defaultProps: { size: "sm" } },
    TextInput: { defaultProps: { size: "sm" } },
    PasswordInput: { defaultProps: { size: "sm" } },
    NumberInput: { defaultProps: { size: "sm" } },
    Select: { defaultProps: { size: "sm" } },
    Switch: { defaultProps: { size: "sm" } },
  },
});
