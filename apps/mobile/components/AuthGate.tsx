/**
 * AuthGate — Biometric lock screen for Maslow.
 *
 * On native (iOS/Android): prompts FaceID/TouchID on launch.
 * On web: skips biometric auth (not available), app loads directly.
 *
 * Encrypted key storage via expo-secure-store for session tokens.
 */

import React, { useState, useEffect, useRef, useCallback } from "react"
import { StyleSheet, View, Text, Pressable, Platform, Animated, AppState } from "react-native"
import * as LocalAuthentication from "expo-local-authentication"
import * as SecureStore from "expo-secure-store"
import FontAwesome from "@expo/vector-icons/FontAwesome"

const BG = "#0F0F0F"
const ACCENT = "#7C5CFC"
const TEXT_PRIMARY = "#E5E5E5"
const TEXT_SECONDARY = "#999999"

const LOCK_TIMEOUT_MS = 5 * 60 * 1000 // Re-lock after 5 minutes in background

interface AuthGateProps {
  children: React.ReactNode
}

export function AuthGate({ children }: AuthGateProps) {
  const [authenticated, setAuthenticated] = useState(false)
  const [checking, setChecking] = useState(true)
  const [biometricAvailable, setBiometricAvailable] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const backgroundTimestamp = useRef<number | null>(null)
  const orbPulse = useRef(new Animated.Value(1)).current
  const orbOpacity = useRef(new Animated.Value(0.5)).current

  // On web, skip biometric auth entirely
  const isWeb = Platform.OS === "web"

  useEffect(() => {
    if (isWeb) {
      setAuthenticated(true)
      setChecking(false)
      return
    }
    checkBiometrics()
  }, [isWeb])

  // Lock when app goes to background for too long
  useEffect(() => {
    if (isWeb) return

    const subscription = AppState.addEventListener("change", (nextState) => {
      if (nextState === "background" || nextState === "inactive") {
        backgroundTimestamp.current = Date.now()
      } else if (nextState === "active" && authenticated) {
        const elapsed = backgroundTimestamp.current
          ? Date.now() - backgroundTimestamp.current
          : 0
        if (elapsed > LOCK_TIMEOUT_MS) {
          setAuthenticated(false)
          setError(null)
        }
        backgroundTimestamp.current = null
      }
    })

    return () => subscription.remove()
  }, [isWeb, authenticated])

  // Animate the orb on the lock screen
  useEffect(() => {
    if (authenticated || checking) return

    const animation = Animated.loop(
      Animated.sequence([
        Animated.parallel([
          Animated.timing(orbPulse, { toValue: 1.15, duration: 2000, useNativeDriver: true }),
          Animated.timing(orbOpacity, { toValue: 0.7, duration: 2000, useNativeDriver: true }),
        ]),
        Animated.parallel([
          Animated.timing(orbPulse, { toValue: 1, duration: 2000, useNativeDriver: true }),
          Animated.timing(orbOpacity, { toValue: 0.5, duration: 2000, useNativeDriver: true }),
        ]),
      ])
    )
    animation.start()
    return () => animation.stop()
  }, [authenticated, checking, orbPulse, orbOpacity])

  const checkBiometrics = useCallback(async () => {
    try {
      const compatible = await LocalAuthentication.hasHardwareAsync()
      const enrolled = await LocalAuthentication.isEnrolledAsync()
      setBiometricAvailable(compatible && enrolled)

      if (compatible && enrolled) {
        authenticate()
      } else {
        // No biometrics — allow access (single-user device)
        setAuthenticated(true)
        setChecking(false)
      }
    } catch {
      // Biometrics check failed — allow access
      setAuthenticated(true)
      setChecking(false)
    }
  }, [])

  const authenticate = useCallback(async () => {
    setError(null)
    setChecking(true)

    try {
      const result = await LocalAuthentication.authenticateAsync({
        promptMessage: "Unlock Maslow",
        cancelLabel: "Cancel",
        disableDeviceFallback: false,
        fallbackLabel: "Use Passcode",
      })

      if (result.success) {
        setAuthenticated(true)
        // Record auth timestamp for session management
        await SecureStore.setItemAsync("maslow_last_auth", String(Date.now()))
      } else {
        setError(result.error === "user_cancel" ? null : "Authentication failed")
      }
    } catch {
      setError("Authentication unavailable")
    } finally {
      setChecking(false)
    }
  }, [])

  if (authenticated) {
    return <>{children}</>
  }

  // Lock screen
  return (
    <View style={styles.container}>
      <View style={styles.lockContent}>
        <Animated.View
          style={[
            styles.orb,
            { transform: [{ scale: orbPulse }], opacity: orbOpacity },
          ]}
        />
        <View style={styles.orbInner} />

        <Text style={styles.title}>Maslow</Text>

        {checking ? (
          <Text style={styles.subtitle}>Authenticating...</Text>
        ) : (
          <>
            {error && <Text style={styles.errorText}>{error}</Text>}
            {biometricAvailable && (
              <Pressable
                style={({ pressed }) => [styles.unlockButton, pressed && styles.unlockButtonPressed]}
                onPress={authenticate}
              >
                <FontAwesome name="lock" size={18} color="#FFFFFF" />
                <Text style={styles.unlockText}>Unlock</Text>
              </Pressable>
            )}
          </>
        )}
      </View>
    </View>
  )
}

// Secure store helpers for the rest of the app
export async function getSecureItem(key: string): Promise<string | null> {
  if (Platform.OS === "web") return null
  return SecureStore.getItemAsync(key)
}

export async function setSecureItem(key: string, value: string): Promise<void> {
  if (Platform.OS === "web") return
  await SecureStore.setItemAsync(key, value)
}

export async function deleteSecureItem(key: string): Promise<void> {
  if (Platform.OS === "web") return
  await SecureStore.deleteItemAsync(key)
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: BG,
  },
  lockContent: {
    flex: 1,
    justifyContent: "center",
    alignItems: "center",
    paddingHorizontal: 40,
  },
  orb: {
    position: "absolute",
    width: 160,
    height: 160,
    borderRadius: 80,
    backgroundColor: ACCENT,
  },
  orbInner: {
    width: 80,
    height: 80,
    borderRadius: 40,
    backgroundColor: ACCENT,
    marginBottom: 40,
  },
  title: {
    color: TEXT_PRIMARY,
    fontSize: 28,
    fontWeight: "700",
    marginBottom: 8,
  },
  subtitle: {
    color: TEXT_SECONDARY,
    fontSize: 14,
    fontStyle: "italic",
  },
  errorText: {
    color: "#F87171",
    fontSize: 14,
    marginBottom: 16,
  },
  unlockButton: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: ACCENT,
    paddingHorizontal: 24,
    paddingVertical: 14,
    borderRadius: 24,
    marginTop: 24,
    gap: 10,
  },
  unlockButtonPressed: {
    opacity: 0.8,
  },
  unlockText: {
    color: "#FFFFFF",
    fontSize: 16,
    fontWeight: "600",
  },
})
