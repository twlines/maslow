// Maslow dark-first color system
const accent = "#7C5CFC";

const colors = {
  text: "#E5E5E5",
  textSecondary: "#999999",
  background: "#0F0F0F",
  surface: "#1A1A1A",
  surfaceElevated: "#252525",
  border: "#333333",
  tint: accent,
  tabIconDefault: "#666666",
  tabIconSelected: accent,
  accent,
  accentHover: "#9B7FFF",
  success: "#34D399",
  warning: "#FBBF24",
  error: "#F87171",
  sentBubble: accent,
  receivedBubble: "#1A1A1A",
  aiThinking: "#2D2044",
};

// Dark mode is the only mode
export default {
  light: colors,
  dark: colors,
};
