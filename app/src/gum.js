
// Gets the users camera and returns the media stream
module.exports.GUM = async (fps, w, h) => {
  const constrants = Object.freeze({
    audio: false, 
    video: {
      width: w ? {max: w} : undefined,
      height: h ? {max: h} : undefined,
      frameRate: fps ? {ideal: fps}: undefined,
    }
  });
  return await navigator.mediaDevices.getDisplayMedia(constrants);
};
