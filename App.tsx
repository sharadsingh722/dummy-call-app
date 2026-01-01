/**
 * Sample React Native App
 * https://github.com/facebook/react-native
 *
 * @format
 */

import { NewAppScreen } from '@react-native/new-app-screen';
import messaging from '@react-native-firebase/messaging';
import React, { useEffect, useMemo, useState, useSyncExternalStore } from 'react';
import {
  Pressable,
  ScrollView,
  StatusBar,
  StyleSheet,
  Text,
  useColorScheme,
  View,
} from 'react-native';
import {
  SafeAreaProvider,
  useSafeAreaInsets,
} from 'react-native-safe-area-context';
import {
  bootstrapCallService,
  handleIncomingInvite,
  handleRemoteMessage,
  requestAndroidPermissions,
} from './src/calls/CallService';
import { getCallUiState, subscribeCallUiState } from './src/calls/callUiStore';

const HARDCODED_FCM_TOKEN = 'fiaZQ6KrSMCesY39ltQUaB:APA91bHLoogXSJFu0ioTMl01xBvZuDQJK4K4ucevu63ORB7kGdgRWCWQWWrfwvTRGeu1o6mV8IA7re8-Xz0_IBsN7gFY9lM0HOR53cN9CLdrFxqKLyR2pjE';

function App() {
  const isDarkMode = useColorScheme() === 'dark';

  return (
    <SafeAreaProvider>
      <StatusBar barStyle={isDarkMode ? 'light-content' : 'dark-content'} />
      <AppContent />
    </SafeAreaProvider>
  );
}

function AppContent() {
  const safeAreaInsets = useSafeAreaInsets();
  const callUiState = useSyncExternalStore(subscribeCallUiState, getCallUiState, getCallUiState);
  const [token, setToken] = useState<string>(HARDCODED_FCM_TOKEN);

  const callStatusLine = useMemo(() => {
    if (callUiState.status === 'idle') return 'idle';
    return `${callUiState.status} • ${callUiState.callerName ?? ''} • ${callUiState.callId ?? ''}`.trim();
  }, [callUiState]);

  useEffect(() => {
    bootstrapCallService().catch(() => {});
    const unsub = messaging().onMessage(async remoteMessage => {
      console.log('[fcm] onMessage fired', {
        messageId: remoteMessage?.messageId,
        from: remoteMessage?.from,
        data: remoteMessage?.data,
        notification: remoteMessage?.notification,
      });
      await handleRemoteMessage(remoteMessage, 'fcm_foreground');
    });

    const unsubOpened = messaging().onNotificationOpenedApp(remoteMessage => {
      console.log('[fcm] onNotificationOpenedApp', {
        messageId: remoteMessage?.messageId,
        from: remoteMessage?.from,
        data: remoteMessage?.data,
        notification: remoteMessage?.notification,
      });
    });

    messaging()
      .getInitialNotification()
      .then(remoteMessage => {
        console.log('[fcm] getInitialNotification', {
          hasMessage: Boolean(remoteMessage),
          messageId: remoteMessage?.messageId,
          from: remoteMessage?.from,
          data: remoteMessage?.data,
          notification: remoteMessage?.notification,
        });
      })
      .catch(error => console.warn('[fcm] getInitialNotification error', error));

    return () => {
      unsub();
      unsubOpened();
    };
  }, []);

  async function refreshToken() {
    const newToken = await messaging().getToken();
    setToken(newToken);
    console.log('[fcm] token', newToken);
  }

  async function simulateIncomingCall() {
    await handleIncomingInvite(
      {
        type: 'call_invite',
        callId: '9a5b1f2c-5b9a-4f12-8f5f-9e6d7b1b2c3d',
        callerName: 'Alice (simulated)',
        timestampMs: Date.now(),
        ttlSec: 30,
      },
      'simulate',
    );
  }

  return (
    <View style={styles.container}>
      <ScrollView contentContainerStyle={[styles.scroll, { paddingTop: safeAreaInsets.top }]}>
        <Text style={styles.title}>Call notification debug</Text>
        <Text style={styles.label}>Call state</Text>
        <Text style={styles.value}>{callStatusLine}</Text>

        <Text style={styles.label}>FCM t oken (this device)</Text>
        <Text style={styles.value} selectable>
          {token || '(tap "Get token")'}
        </Text>

        <View style={styles.row}>
          <Pressable style={styles.button} onPress={() => requestAndroidPermissions().catch(() => {})}>
            <Text style={styles.buttonText}>Permissions</Text>
          </Pressable>
          <Pressable style={styles.button} onPress={() => refreshToken().catch(() => {})}>
            <Text style={styles.buttonText}>Get token</Text>
          </Pressable>
        </View>

        <View style={styles.row}>
          <Pressable style={styles.button} onPress={() => simulateIncomingCall().catch(() => {})}>
            <Text style={styles.buttonText}>Simulate call</Text>
          </Pressable>
        </View>

        <View style={styles.divider} />

        <NewAppScreen templateFileName="App.tsx" safeAreaInsets={safeAreaInsets} />
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  scroll: {
    paddingHorizontal: 16,
    paddingBottom: 24,
  },
  title: {
    fontSize: 18,
    fontWeight: '700',
    marginBottom: 12,
  },
  label: {
    fontSize: 12,
    opacity: 0.7,
    marginTop: 12,
    marginBottom: 6,
  },
  value: {
    fontSize: 13,
  },
  row: {
    flexDirection: 'row',
    gap: 12,
    marginTop: 12,
  },
  button: {
    paddingVertical: 10,
    paddingHorizontal: 12,
    borderRadius: 10,
    backgroundColor: '#111827',
  },
  buttonText: {
    color: 'white',
    fontWeight: '600',
  },
  divider: {
    height: 1,
    backgroundColor: '#E5E7EB',
    marginVertical: 16,
  },
});

export default App;
