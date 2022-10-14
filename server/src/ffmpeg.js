// Class to handle child process used for running FFmpeg

const child_process = require('child_process');
const { EventEmitter } = require('events');

const { createSdpText } = require('./sdp');
const { convertStringToStream } = require('./utils');

const RECORD_FILE_LOCATION_PATH = process.env.RECORD_FILE_LOCATION_PATH || './files';

module.exports = class FFmpeg {
  constructor (rtpParameters) {
    this._rtpParameters = rtpParameters;
    this._process = undefined;
    this._observer = new EventEmitter();
    this._createProcess();
  }

  _createProcess () {
    const sdpString = createSdpText(this._rtpParameters);
    const sdpStream = convertStringToStream(sdpString);

    console.log('createProcess() [sdpString:%s]', sdpString);

    this._process = child_process.spawn('ffmpeg', this._commandArgs);

    if (this._process.stderr) {
      this._process.stderr.setEncoding('utf-8');

      this._process.stderr.on('data', data =>
        console.log('ffmpeg::process::data [data:%o]', data)
      );
    }

    if (this._process.stdout) {
      this._process.stdout.setEncoding('utf-8');

      this._process.stdout.on('data', data => 
        console.log('ffmpeg::process::data [data:%o]', data)
      );
    }

    this._process.on('message', message =>
      console.log('ffmpeg::process::message [message:%o]', message)
    );

    this._process.on('error', error =>
      console.error('ffmpeg::process::error [error:%o]', error)
    );

    this._process.once('close', () => {
      console.log('ffmpeg::process::close');
      this._observer.emit('process-close');
    });

    sdpStream.on('error', error =>
      console.error('sdpStream::error [error:%o]', error)
    );

    // Pipe sdp stream to the ffmpeg process
    sdpStream.resume();
    sdpStream.pipe(this._process.stdin);
  }

  kill () {
    console.log('kill() [pid:%d]', this._process.pid);
    this._process.kill('SIGINT');
  }

  get _commandArgs () {
    let commandArgs = [
      //'-re',
      //'-loglevel',
      //'debug',
      '-protocol_whitelist',
      'pipe,udp,rtp,rtmp,rtsp',
      '-fflags',
      '+genpts',
      '-f',
      'sdp',
      '-i',
      'pipe:0'
    ];

    if (this._rtpParameters['video']){
      commandArgs = commandArgs.concat(this._videoArgs);
    }
    if (this._rtpParameters['audio']){
      commandArgs = commandArgs.concat(this._audioArgs);
    }

    commandArgs = commandArgs.concat([
      '-flags',
      '+global_header',
      //hase//  `${RECORD_FILE_LOCATION_PATH}/${this._rtpParameters.fileName}.webm`
//	'-c:v', 'libx264', '-x264-params', 'keyint=90:scenecut=0',
//	'-b:v', '1.3M',
//	'-c:a', 'aac',
//	'-maxrate', '1.3M',
//	'-bufsize', '0.2M',
//	'-vcodec', 'copy',
//	'-acodec', 'copy',
//        '-f', 'flv', `rtmp://localhost/${this._rtpParameters.fileName}`
      '-f', 'rtsp', `rtsp://localhost/${this._rtpParameters.fileName}`
    ]);

    console.log('commandArgs:%o', commandArgs);

    return commandArgs;
  }

  get _videoArgs () {
    return [
      '-map',
      '0:v:0',
      '-c:v',
      'copy'
    ];
  }

  get _audioArgs () {
    return [
      '-map',
      '0:a:0',
      '-strict', // libvorbis is experimental
      '-2',
      '-c:a',
//      'copy'
      'aac'
    ];
  }
}
