export const INCOMING_EVENT_NAMES = {
  CONNECTION_SUCCESS: 'connection-success',
  ROUTER_RTP_CAPABILITIES: 'router-rtp-capabilities',
  TRANSPORT_CREATED: 'transport-created',
  NEW_PRODUCER_TRANSPORT_CREATED: 'new-producer-transport-created',
  EXISTING_CLIENTS_LIST: 'existing-clients-list',
  PRODUCING_MEDIA: 'producing-media',
  CONSUMING_MEDIA: 'consuming-media',
}

export const OUTGOING_EVENT_NAMES = {
  JOIN_ROOM: 'join-room',
  CREATE_TRANSPORT: 'create-transport',
  CONNECT_TRANSPORT: 'connect-transport',
  PRODUCE_MEDIA: 'produce-media',
  CONSUME_MEDIA: 'consume-media',
  RESUME_CONSUME: 'resume-consuming-media',
  DISCONNECT: 'disconnect',
}
