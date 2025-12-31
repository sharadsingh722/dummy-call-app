export type CallInvite = {
  type: 'call_invite' | 'voiceCall' | 'videoCall';
  callId: string;
  callerName: string;
  timestampMs: number;
  ttlSec: number;
  actionEndpoint?: string;

  channelName?: string;
  roomId?: string;
  token?: string;
  callerId?: string;
  receiverId?: string;
  calleridDocID?: string;
  receiverDocID?: string;
  category?: string;
  categoryName?: string;
  ProfilePic?: string;
};

export type CallAction = 'accept' | 'decline' | 'missed' | 'busy';

export type CallEnded = {
  type: 'CALL_ENDED';
  callId: string;
  status?: string;
  dismissNotification?: boolean;
};
