const mediasoup = require('mediasoup-client');

const { GUM } = require('./gum');
const Peer = require('./peer');
const SocketQueue = require('./queue');

const mediasoupConfig = require('../../server/src/config');


function getParam(name, url) {
  if (!url) url = window.location.href;
  name = name.replace(/[\[\]]/g, "\\$&");
  var regex = new RegExp("[?&]" + name + "(=([^&#]*)|&|#|$)"),
      results = regex.exec(url);
  if (!results) return null;
  if (!results[2]) return '';
  return decodeURIComponent(results[2].replace(/\+/g, " "));
}
window.onload = ()=>{
  const id = getParam('id');
  if (id) { document.getElementById('screenIdInput').value = id; }
  if (getParam('auto') !== null) { document.getElementById('startRecordButton').click(); }
}


const queues = [new SocketQueue(), new SocketQueue()];
const sockets = []
const peers = [undefined, undefined]
function getPeer(socket){
  const idx = sockets.findIndex(s => s===socket)
  return peers[idx]
}
function getQueue(socket){
  const idx = sockets.findIndex(s => s===socket)
  console.log(`queue ${idx} is used. ${JSON.stringify(sockets)}`)
  return queues[idx]
}

const handleSocketOpen = async () => {
  console.log('handleSocketOpen()');
};

const handleSocketMessage = async (message, socket) => {
  try {
    const jsonMessage = JSON.parse(message.data);
    handleJsonMessage(jsonMessage, socket);
  } catch (error) {
    console.error('handleSocketMessage() failed [error:%o]', error);
  }
};

const handleSocketClose = () => {
  console.log('handleSocketClose()');
  document.getElementById('startRecordButton').disabled = true;
  document.getElementById('stopRecordButton').disabled = true;
};

const getVideoCodecs = () => {
  const params = new URLSearchParams(location.search.slice(1));
  const videoCodec = params.get('videocodec')
  console.warn('videoCodec');

  const codec = mediasoupConfig.router.mediaCodecs.find(c=>{
    if (!videoCodec)
      return undefined;

    return ~c.mimeType.toLowerCase().indexOf(videoCodec.toLowerCase())
  });

  console.warn('codec', codec);
  return codec ? codec : {
    kind: 'video',
    mimeType: 'video/VP8',
    clockRate: 90000,
    parameters: {
      'x-google-start-bitrate': 1000
    }
  };
}

const handleSocketError = error => {
  console.error('handleSocketError() [error:%o]', error);
};

const handleJsonMessage = async (jsonMessage, socket) => {
  const { action } = jsonMessage;

  switch (action) {
    case 'router-rtp-capabilities':
      handleRouterRtpCapabilitiesRequest(jsonMessage, socket);
      break;
    case 'create-transport':
      handleCreateTransportRequest(jsonMessage, socket);
      break;
    case 'connect-transport':
      handleConnectTransportRequest(jsonMessage, socket);
      break;
    case 'produce':
      handleProduceRequest(jsonMessage, socket);
      break;
    default: console.log('handleJsonMessage() unknown action %s', action);
  }
};

let device;
const handleRouterRtpCapabilitiesRequest = async (jsonMessage, socket) => {
  const { routerRtpCapabilities, sessionId } = jsonMessage;
  console.log('handleRouterRtpCapabilities() [rtpCapabilities:%o]', routerRtpCapabilities);
  console.log(`sessionID: ${sessionId}`);

  try {
    if (!device){
      device = new mediasoup.Device();
      // Load the mediasoup device with the router rtp capabilities gotten from the server
      await device.load({ routerRtpCapabilities });
    }
    const idx = sockets.findIndex((s) => s === socket)
    if (!peers[idx]){
      peers[idx] = new Peer(sessionId, device);
    }
    createTransport(socket);
  } catch (error) {
    console.error('handleRouterRtpCapabilities() failed to init device [error:%o]', error);
    socket.close();
  }
};

const createTransport = (socket) => {
  console.log('createTransport()');
  const peer = getPeer(socket)

  if (!peer || !peer.device.loaded) {
    throw new Error('Peer or device is not initialized');
  }

  // First we must create the mediasoup transport on the server side
  socket.send(JSON.stringify({
    action: 'create-transport',
    sessionId: peer.sessionId
  }));
};

// Mediasoup Transport on the server side has been created
const handleCreateTransportRequest = async (jsonMessage, socket) => {
  console.log('handleCreateTransportRequest() [data:%o]', jsonMessage);
  const peer = getPeer(socket)

  try {
    // Create the local mediasoup send transport
    peer.sendTransport = await peer.device.createSendTransport(jsonMessage);
    console.log('handleCreateTransportRequest() send transport created [id:%s]', peer.sendTransport.id);

    // Set the transport listeners and get the users media stream
    handleSendTransportListeners(socket);
    let fps = Number(document.getElementById('fps').value);
    fps = Number.isInteger(fps) ? fps : undefined;
    document.getElementById('fps').value = fps
    
    let w = Number(document.getElementById('width').value);
    w = Number.isInteger(w) ? w : undefined;
    document.getElementById('width').value = w
    
    let h = Number(document.getElementById('height').value);
    h = Number.isInteger(h) ? h : undefined;
    document.getElementById('height').value = h
    
    getMediaStream(socket, fps,w,h).then(()=>{
      recordStep2(socket);
    });
  } catch (error) {
    console.error('handleCreateTransportRequest() failed to create transport [error:%o]', error);
    socket.close();
  }
};

const handleSendTransportListeners = (socket) => {
  const peer = getPeer(socket)

  peer.sendTransport.on('connect', (...args) => {handleTransportConnectEvent(socket, ...args)});
  peer.sendTransport.on('produce', (...args) => {handleTransportProduceEvent(socket, ...args)});
  peer.sendTransport.on('connectionstatechange', connectionState => {
    console.log('send transport connection state change [state:%s]', connectionState);
  });
};

function createUpsideDown(mediaStream,fps, w, h){
  const video = document.createElement('video');
  video.width = w;
  video.height = h;
  video.autoplay = true;  
  const msVideo = new MediaStream();
  msVideo.addTrack(mediaStream.getVideoTracks()[0]);
  video.srcObject = msVideo;
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext('2d');
  ctx.translate(0, h);
  ctx.scale(1,-1);
  setInterval(()=>{
    ctx.drawImage(video, 0, 0);
  },1000/fps)
  const rv = canvas.captureStream(fps);
  rv.addTrack(mediaStream.getAudioTracks()[0]);
  return rv;
}
async function createProducer(mediaStream, peer){
  // Get the video and audio tracks from the media stream
  const videoTrack = mediaStream.getVideoTracks()[0];
  const audioTrack = mediaStream.getAudioTracks()[0];

  // If there is a video track start sending it to the server
  if (videoTrack) {
    let bitrate = Number(document.getElementById('bitrate').value) * 1000*1000;
    bitrate = Number.isFinite(bitrate) ? Math.floor(bitrate) : 1500*1000;
    const videoProducer = await peer.sendTransport.produce({ track: videoTrack,
      encodings: [{maxBitrate: bitrate}]
     });
    peer.producers.push(videoProducer);
  }

  // if there is a audio track start sending it to the server
  if (audioTrack) {
    const audioProducer = await peer.sendTransport.produce({ track: audioTrack });
    peer.producers.push(audioProducer);
  }
}

let mediaStream;
let mediaStreamUd;
let resolveForUd;
let peerForUd;
const getMediaStream = (socket, fps,w,h) => {
  const promise = new Promise((resolve, reject) => {
    const peer = getPeer(socket)
    if (socket === sockets[0]){
      GUM(fps, w, h).then((ms)=>{
        mediaStream = ms;
        createProducer(mediaStream, peer).then(()=>{
          resolve();
          if (resolveForUd){
            setTimeout(()=>{
              mediaStreamUd = createUpsideDown(mediaStream, fps, w, h);
              createProducer(mediaStreamUd, peerForUd).then(()=>{
                resolveForUd();
              })  
            }, 1000);
          }
        })
      })
    }else{
      if (!mediaStream){
        resolveForUd = resolve;
        peerForUd = peer
      }else{
        mediaStreamUd = createUpsideDown(mediaStream, fps, w, h)
        const videoNode = document.getElementById('localVideo');
        if(videoNode){ videoNode.srcObject = mediaStreamUd; }
        createProducer(mediaStreamUd, peer).then(()=>{
          resolve();
        })
      }
    }
  });

  // Disable the start record button
  document.getElementById('startRecordButton').disabled = true;
  document.getElementById('fps').disabled = true;
  document.getElementById('width').disabled = true;
  document.getElementById('height').disabled = true;  
  return promise;
};

const handleConnectTransportRequest = async (jsonMessage, socket) => {
  console.log('handleTransportConnectRequest()');
  const queue = getQueue(socket);
  try {
    const action = queue.get('connect-transport');

    if (!action) {
      throw new Error('transport-connect action was not found');
    }

    await action(jsonMessage);
  } catch (error) {
    console.error('handleTransportConnectRequest() failed [error:%o]', error);
  }
};

const handleProduceRequest = async (jsonMessage, socket) => {
  console.log('handleProduceRequest()');
  const queue = getQueue(socket);
  try {
    const action = queue.get('produce');

    if (!action) {
      throw new Error('produce action was not found');
    }

    await action(jsonMessage);
  } catch (error) {
    console.error('handleProduceRequest() failed [error:%o]', error);
  }
};

const handleTransportConnectEvent = (socket, { dtlsParameters }, callback, errback) => {
  console.log('handleTransportConnectEvent()');
  const peer = getPeer(socket)
  const queue = getQueue(socket);

  try {
    const action = (jsonMessage) => {
      console.log('connect-transport action');
      callback();
      queue.remove('connect-transport');
    };

    queue.push('connect-transport', action);

    socket.send(JSON.stringify({
      action: 'connect-transport',
      sessionId: peer.sessionId,
      transportId: peer.sendTransport.id,
      dtlsParameters
    }));
  } catch (error) {
    console.error('handleTransportConnectEvent() failed [error:%o]', error);
    errback(error);
  }
};

const handleTransportProduceEvent = (socket, { kind, rtpParameters }, callback, errback) => {
  console.log('handleTransportProduceEvent()');
  const peer = getPeer(socket)
  const queue = getQueue(socket);

  try {
    const action = jsonMessage => {
      console.log('handleTransportProduceEvent callback [data:%o]', jsonMessage);
      callback({ id: jsonMessage.id });
      queue.remove('produce');
    };

    queue.push('produce', action);

    socket.send(JSON.stringify({
      action: 'produce',
      sessionId: peer.sessionId,
      transportId: peer.sendTransport.id,
      kind,
      rtpParameters
    }));
  } catch (error) {
    console.error('handleTransportProduceEvent() failed [error:%o]', error);
    errback(error);
  }
};

function recordStep2(socket){
  const peer = getPeer(socket)
  let screenId = document.getElementById('screenIdInput').value;
  if (socket !== sockets[0]){
    screenId = `${screenId}d`;
  }
  console.log(`screenId: ${screenId}`)
  socket.send(JSON.stringify({
    action: 'start-record',
    sessionId: peer.sessionId,
    screenId
  }));

  document.getElementById('startRecordButton').disabled = true;
  document.getElementById('stopRecordButton').disabled = false;  
}
module.exports.startRecord = () => {
  console.log('startRecord()');
  if (sockets.length === 0){
    for(let i=0; i<2; ++i){
      setTimeout(()=>{
        //socket = new WebSocket('ws://localhost:3030');
        const socket = new WebSocket('wss://vrc.jp/msstreamer');
        socket.id = i;
        sockets.push(socket);

        socket.addEventListener('open', handleSocketOpen);
        socket.addEventListener('message', (msg) => {handleSocketMessage(msg, socket)});
        socket.addEventListener('error', handleSocketError);
        socket.addEventListener('close', handleSocketClose);  
      }, i*1000)
    }
  }else{
    sockets.forEach(socket=>{
      recordStep2(socket)
    });
  }
};

module.exports.stopRecord = () => {
  console.log('stopRecord()');
  for(let i=0; i<sockets.length; ++i){
    sockets[i].send(JSON.stringify({
      action: 'stop-record',
      sessionId: peers[i].sessionId
    }));
  }

  document.getElementById('startRecordButton').disabled = false;
  document.getElementById('stopRecordButton').disabled = true;
};
