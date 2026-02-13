import FontAwesome from "@expo/vector-icons/FontAwesome";
import { ThemeProvider, DarkTheme } from "@react-navigation/native";
import Constants from "expo-constants";
import { useFonts } from "expo-font";
import { Stack } from "expo-router";
import * as SplashScreen from "expo-splash-screen";
import { useEffect } from "react";
import "react-native-reanimated";
import { AuthGate } from "../components/AuthGate";
import { configure } from "../services/api";

export { ErrorBoundary } from "expo-router";

export const unstable_settings = {
  initialRouteName: "(tabs)",
};

const extra = Constants.expoConfig?.extra
configure({
  host: extra?.MASLOW_API_HOST ?? undefined,
  port: extra?.MASLOW_API_PORT ?? undefined,
})

SplashScreen.preventAutoHideAsync();

// Maslow dark theme based on React Navigation's DarkTheme
const MaslowTheme = {
  ...DarkTheme,
  colors: {
    ...DarkTheme.colors,
    primary: "#7C5CFC",
    background: "#0F0F0F",
    card: "#1A1A1A",
    text: "#E5E5E5",
    border: "#333333",
    notification: "#7C5CFC",
  },
};

export default function RootLayout() {
  const [loaded, error] = useFonts({
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    SpaceMono: require("../assets/fonts/SpaceMono-Regular.ttf"),
    ...FontAwesome.font,
  });

  useEffect(() => {
    if (error) throw error;
  }, [error]);

  useEffect(() => {
    if (loaded) {
      SplashScreen.hideAsync();
    }
  }, [loaded]);

  if (!loaded) return null;

  return (
    <ThemeProvider value={MaslowTheme}>
      <AuthGate>
        <Stack>
          <Stack.Screen name="(tabs)" options={{ headerShown: false }} />
        </Stack>
      </AuthGate>
    </ThemeProvider>
  );
}
