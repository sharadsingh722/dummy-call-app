/**
 * @format
 */

import { AppRegistry } from 'react-native';
import messaging from '@react-native-firebase/messaging';
import App from './App';
import { name as appName } from './app.json';
import { bootstrapCallService, handleRemoteMessage } from './src/calls/CallService';

bootstrapCallService();

messaging().setBackgroundMessageHandler(async remoteMessage => {
  console.log('[fcm] setBackgroundMessageHandler fired', {
    messageId: remoteMessage?.messageId,
    from: remoteMessage?.from,
    data: remoteMessage?.data,
    notification: remoteMessage?.notification,
  });
  await handleRemoteMessage(remoteMessage, 'fcm_background');
});

AppRegistry.registerComponent(appName, () => App);
