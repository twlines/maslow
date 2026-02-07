import React from "react";
import FontAwesome from "@expo/vector-icons/FontAwesome";
import { Tabs } from "expo-router";

const ACCENT = "#7C5CFC";
const TAB_INACTIVE = "#666666";
const TAB_BAR_BG = "#1A1A1A";
const TAB_BAR_BORDER = "#333333";

function TabIcon(props: { name: React.ComponentProps<typeof FontAwesome>["name"]; color: string }) {
  return <FontAwesome size={22} style={{ marginBottom: -2 }} {...props} />;
}

export default function TabLayout() {
  return (
    <Tabs
      screenOptions={{
        tabBarActiveTintColor: ACCENT,
        tabBarInactiveTintColor: TAB_INACTIVE,
        tabBarStyle: {
          backgroundColor: TAB_BAR_BG,
          borderTopColor: TAB_BAR_BORDER,
          borderTopWidth: 0.5,
        },
        headerStyle: {
          backgroundColor: TAB_BAR_BG,
        },
        headerTintColor: "#E5E5E5",
        headerShadowVisible: false,
      }}
    >
      <Tabs.Screen
        name="index"
        options={{
          title: "Talk",
          tabBarIcon: ({ color }) => <TabIcon name="comment" color={color} />,
        }}
      />
      <Tabs.Screen
        name="review"
        options={{
          title: "Review",
          tabBarIcon: ({ color }) => <TabIcon name="clock-o" color={color} />,
        }}
      />
      <Tabs.Screen
        name="build"
        options={{
          title: "Build",
          tabBarIcon: ({ color }) => <TabIcon name="th-large" color={color} />,
        }}
      />
    </Tabs>
  );
}
