import { MediaFile } from '../types';

export const useXMLExporter = () => {

  const generateXML = (files: MediaFile[], sequenceName: string = "StoryGraph_Multicam_Sync") => {
    const firstVideo = files.find(f => f.media_category === 'video' && f.tech_metadata?.frame_rate_fraction);
    let TIMELINE_FPS = 25;
    if (firstVideo?.tech_metadata?.frame_rate_fraction) {
        const fpsStr = firstVideo.tech_metadata.frame_rate_fraction.toString();
        TIMELINE_FPS = fpsStr.includes('/') ? Math.round(Number(fpsStr.split('/')[0]) / Number(fpsStr.split('/')[1])) : Math.round(parseFloat(fpsStr));
    }

    const timelineStartFrame = 3600 * TIMELINE_FPS; // 01:00:00:00
    const LOCAL_ROOT = "/Users/lelanie/Library/CloudStorage/GoogleDrive-ambientartsza@gmail.com/My%20Drive/App%20Development/Story%20Graph%20[Cloud]/Code%20(Development%20Phase)/Mutlicam%20Test/Proxies%202/";
    const pathPrefix = `file://${LOCAL_ROOT}`;

    const videoAngles = files.filter(f => f.clip_type === 'interview' && f.media_category === 'video');
    const masterAudio = files.filter(f => f.clip_type === 'interview' && f.media_category === 'audio');

    // Get clip duration in TIMELINE frames (always at TIMELINE_FPS)
    const getClipDuration = (file: MediaFile) => {
      if (file.tech_metadata?.total_frames) {
        const nativeFPS = parseFloat(file.tech_metadata.frame_rate_fraction?.toString() || String(TIMELINE_FPS));
        const nativeFrames = parseInt(file.tech_metadata.total_frames.toString(), 10);
        // Convert native frames to timeline frames
        return Math.round((nativeFrames / nativeFPS) * TIMELINE_FPS);
      }
      return file.duration ? Math.round((file.duration / 1000) * TIMELINE_FPS) : 250;
    };

    // Get file's NATIVE duration and framerate
    const getFileDuration = (file: MediaFile) => {
      if (file.tech_metadata?.total_frames) {
        return parseInt(file.tech_metadata.total_frames.toString(), 10);
      }
      const clipDur = getClipDuration(file);
      return clipDur;
    };

    const getFileFramerate = (file: MediaFile) => {
      if (file.tech_metadata?.frame_rate_fraction) {
        const fpsStr = file.tech_metadata.frame_rate_fraction.toString();
        return fpsStr.includes('/')
          ? Math.round(Number(fpsStr.split('/')[0]) / Number(fpsStr.split('/')[1]))
          : Math.round(parseFloat(fpsStr));
      }
      return TIMELINE_FPS;
    };

    // Calculate sequence duration (longest clip end point)
    let maxEndFrame = 0;
    [...videoAngles, ...masterAudio].forEach(file => {
      const duration = getClipDuration(file);
      const start = file.sync_offset_frames || 0;
      const end = start + duration;
      if (end > maxEndFrame) maxEndFrame = end;
    });

    let xml = `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE xmeml>
<xmeml version="5">
    <sequence>
        <name>${sequenceName}</name>
        <duration>${maxEndFrame}</duration>
        <rate>
            <timebase>${TIMELINE_FPS}</timebase>
            <ntsc>FALSE</ntsc>
        </rate>
        <in>-1</in>
        <out>-1</out>
        <timecode>
            <string>01:00:00:00</string>
            <frame>${timelineStartFrame}</frame>
            <displayformat>NDF</displayformat>
            <rate>
                <timebase>${TIMELINE_FPS}</timebase>
                <ntsc>FALSE</ntsc>
            </rate>
        </timecode>
        <media>
            <video>`;

    // --- VIDEO TRACKS ---
    videoAngles.forEach((file, idx) => {
      const clipDuration = getClipDuration(file);
      const fileDuration = getFileDuration(file);
      const fileFPS = getFileFramerate(file);
      const start = file.sync_offset_frames || 0;
      const end = start + clipDuration;
      const fullPath = file.relative_path ? `${pathPrefix}${file.relative_path}/${file.filename}` : `${pathPrefix}${file.filename}`;
      const fileId = `${file.filename} 2`;
      const clipId = `${file.filename} 0`;
      const audioClipId = `${file.filename} 3`;
      const width = file.tech_metadata?.width || 1920;
      const height = file.tech_metadata?.height || 1080;

      // Calculate file timecode frame from start_tc
      const startTc = file.tech_metadata?.start_tc || '00:00:00:00';
      const tcParts = startTc.split(':').map(Number);
      const fileTimecodeFrame = ((tcParts[0] * 3600) + (tcParts[1] * 60) + tcParts[2]) * fileFPS + tcParts[3];

      xml += `
                <track>
                    <clipitem id="${clipId}">
                        <name>${file.filename}</name>
                        <duration>${clipDuration}</duration>
                        <rate>
                            <timebase>${TIMELINE_FPS}</timebase>
                            <ntsc>FALSE</ntsc>
                        </rate>
                        <start>${start}</start>
                        <end>${end}</end>
                        <enabled>TRUE</enabled>
                        <in>0</in>
                        <out>${clipDuration}</out>
                        <file id="${fileId}">
                            <duration>${fileDuration}</duration>
                            <rate>
                                <timebase>${fileFPS}</timebase>
                                <ntsc>FALSE</ntsc>
                            </rate>
                            <name>${file.filename}</name>
                            <pathurl>${fullPath}</pathurl>
                            <timecode>
                                <string>${startTc}</string>
                                <displayformat>NDF</displayformat>
                                <rate>
                                    <timebase>${fileFPS}</timebase>
                                    <ntsc>FALSE</ntsc>
                                </rate>
                            </timecode>
                            <media>
                                <video>
                                    <duration>${fileDuration}</duration>
                                    <samplecharacteristics>
                                        <width>${width}</width>
                                        <height>${height}</height>
                                    </samplecharacteristics>
                                </video>
                                <audio>
                                    <channelcount>2</channelcount>
                                </audio>
                            </media>
                        </file>
                        <compositemode>normal</compositemode>
                        <filter>
                            <enabled>TRUE</enabled>
                            <start>0</start>
                            <end>${clipDuration}</end>
                            <effect>
                                <name>Basic Motion</name>
                                <effectid>basic</effectid>
                                <effecttype>motion</effecttype>
                                <mediatype>video</mediatype>
                                <effectcategory>motion</effectcategory>
                                <parameter>
                                    <name>Scale</name>
                                    <parameterid>scale</parameterid>
                                    <value>100</value>
                                    <valuemin>0</valuemin>
                                    <valuemax>10000</valuemax>
                                </parameter>
                                <parameter>
                                    <name>Center</name>
                                    <parameterid>center</parameterid>
                                    <value>
                                        <horiz>0</horiz>
                                        <vert>0</vert>
                                    </value>
                                </parameter>
                                <parameter>
                                    <name>Rotation</name>
                                    <parameterid>rotation</parameterid>
                                    <value>0</value>
                                    <valuemin>-100000</valuemin>
                                    <valuemax>100000</valuemax>
                                </parameter>
                                <parameter>
                                    <name>Anchor Point</name>
                                    <parameterid>centerOffset</parameterid>
                                    <value>
                                        <horiz>0</horiz>
                                        <vert>0</vert>
                                    </value>
                                </parameter>
                            </effect>
                        </filter>
                        <filter>
                            <enabled>TRUE</enabled>
                            <start>0</start>
                            <end>${clipDuration}</end>
                            <effect>
                                <name>Crop</name>
                                <effectid>crop</effectid>
                                <effecttype>motion</effecttype>
                                <mediatype>video</mediatype>
                                <effectcategory>motion</effectcategory>
                                <parameter>
                                    <name>left</name>
                                    <parameterid>left</parameterid>
                                    <value>0</value>
                                    <valuemin>0</valuemin>
                                    <valuemax>100</valuemax>
                                </parameter>
                                <parameter>
                                    <name>right</name>
                                    <parameterid>right</parameterid>
                                    <value>0</value>
                                    <valuemin>0</valuemin>
                                    <valuemax>100</valuemax>
                                </parameter>
                                <parameter>
                                    <name>top</name>
                                    <parameterid>top</parameterid>
                                    <value>0</value>
                                    <valuemin>0</valuemin>
                                    <valuemax>100</valuemax>
                                </parameter>
                                <parameter>
                                    <name>bottom</name>
                                    <parameterid>bottom</parameterid>
                                    <value>0</value>
                                    <valuemin>0</valuemin>
                                    <valuemax>100</valuemax>
                                </parameter>
                            </effect>
                        </filter>
                        <filter>
                            <enabled>TRUE</enabled>
                            <start>0</start>
                            <end>${clipDuration}</end>
                            <effect>
                                <name>Opacity</name>
                                <effectid>opacity</effectid>
                                <effecttype>motion</effecttype>
                                <mediatype>video</mediatype>
                                <effectcategory>motion</effectcategory>
                                <parameter>
                                    <name>opacity</name>
                                    <parameterid>opacity</parameterid>
                                    <value>100</value>
                                    <valuemin>0</valuemin>
                                    <valuemax>100</valuemax>
                                </parameter>
                            </effect>
                        </filter>
                        <link>
                            <linkclipref>${clipId}</linkclipref>
                        </link>
                        <link>
                            <linkclipref>${audioClipId}</linkclipref>
                        </link>
                        <comments/>
                    </clipitem>
                    <enabled>TRUE</enabled>
                    <locked>FALSE</locked>
                </track>`;
    });

    xml += `
                <format>
                    <samplecharacteristics>
                        <width>1920</width>
                        <height>1080</height>
                        <pixelaspectratio>square</pixelaspectratio>
                        <rate>
                            <timebase>${TIMELINE_FPS}</timebase>
                            <ntsc>FALSE</ntsc>
                        </rate>
                        <codec>
                            <appspecificdata>
                                <appname>Final Cut Pro</appname>
                                <appmanufacturer>Apple Inc.</appmanufacturer>
                                <data>
                                    <qtcodec/>
                                </data>
                            </appspecificdata>
                        </codec>
                    </samplecharacteristics>
                </format>
            </video>
            <audio>`;

    // --- AUDIO TRACKS: Camera scratch audio FIRST (linked to video) ---
    videoAngles.forEach((file, idx) => {
      const clipDuration = getClipDuration(file);
      const start = file.sync_offset_frames || 0;
      const end = start + clipDuration;
      const fileId = `${file.filename} 2`;
      const clipId = `${file.filename} 0`;
      const audioClipId = `${file.filename} 3`;

      xml += `
                <track>
                    <clipitem id="${audioClipId}">
                        <name>${file.filename}</name>
                        <duration>${clipDuration}</duration>
                        <rate>
                            <timebase>${TIMELINE_FPS}</timebase>
                            <ntsc>FALSE</ntsc>
                        </rate>
                        <start>${start}</start>
                        <end>${end}</end>
                        <enabled>TRUE</enabled>
                        <in>0</in>
                        <out>${clipDuration}</out>
                        <file id="${fileId}"/>
                        <sourcetrack>
                            <mediatype>audio</mediatype>
                            <trackindex>1</trackindex>
                        </sourcetrack>
                        <filter>
                            <enabled>TRUE</enabled>
                            <start>0</start>
                            <end>${clipDuration}</end>
                            <effect>
                                <name>Audio Levels</name>
                                <effectid>audiolevels</effectid>
                                <effecttype>audiolevels</effecttype>
                                <mediatype>audio</mediatype>
                                <effectcategory>audiolevels</effectcategory>
                                <parameter>
                                    <name>Level</name>
                                    <parameterid>level</parameterid>
                                    <value>1</value>
                                    <valuemin>1e-05</valuemin>
                                    <valuemax>31.6228</valuemax>
                                </parameter>
                            </effect>
                        </filter>
                        <filter>
                            <enabled>TRUE</enabled>
                            <start>0</start>
                            <end>${clipDuration}</end>
                            <effect>
                                <name>Audio Pan</name>
                                <effectid>audiopan</effectid>
                                <effecttype>audiopan</effecttype>
                                <mediatype>audio</mediatype>
                                <effectcategory>audiopan</effectcategory>
                                <parameter>
                                    <name>Pan</name>
                                    <parameterid>pan</parameterid>
                                    <value>0</value>
                                    <valuemin>-1</valuemin>
                                    <valuemax>1</valuemax>
                                </parameter>
                            </effect>
                        </filter>
                        <link>
                            <linkclipref>${clipId}</linkclipref>
                            <mediatype>video</mediatype>
                        </link>
                        <link>
                            <linkclipref>${audioClipId}</linkclipref>
                        </link>
                        <comments/>
                    </clipitem>
                    <enabled>TRUE</enabled>
                    <locked>FALSE</locked>
                </track>`;
    });

    // --- AUDIO TRACK: MASTER SPINE LAST (not linked to video) ---
    masterAudio.forEach((file, idx) => {
      const clipDuration = getClipDuration(file);
      const fileDuration = getFileDuration(file);
      const fileFPS = getFileFramerate(file);
      const start = file.sync_offset_frames || 0;
      const end = start + clipDuration;
      const fullPath = file.relative_path ? `${pathPrefix}${file.relative_path}/${file.filename}` : `${pathPrefix}${file.filename}`;
      const fileId = `${file.filename} 1`;
      const clipId = `${file.filename} 0`;

      // Calculate file timecode frame from start_tc
      const startTc = file.tech_metadata?.start_tc || '00:00:00:00';
      const tcParts = startTc.split(':').map(Number);
      const fileTimecodeFrame = ((tcParts[0] * 3600) + (tcParts[1] * 60) + tcParts[2]) * fileFPS + tcParts[3];

      xml += `
                <track>
                    <clipitem id="${clipId}">
                        <name>${file.filename}</name>
                        <duration>${clipDuration}</duration>
                        <rate>
                            <timebase>${TIMELINE_FPS}</timebase>
                            <ntsc>FALSE</ntsc>
                        </rate>
                        <start>${start}</start>
                        <end>${end}</end>
                        <enabled>TRUE</enabled>
                        <in>0</in>
                        <out>${clipDuration}</out>
                        <file id="${fileId}">
                            <duration>${fileDuration}</duration>
                            <rate>
                                <timebase>${fileFPS}</timebase>
                                <ntsc>FALSE</ntsc>
                            </rate>
                            <name>${file.filename}</name>
                            <pathurl>${fullPath}</pathurl>
                            <timecode>
                                <string>${startTc}</string>
                                <frame>${fileTimecodeFrame}</frame>
                                <displayformat>NDF</displayformat>
                                <rate>
                                    <timebase>${fileFPS}</timebase>
                                    <ntsc>FALSE</ntsc>
                                </rate>
                            </timecode>
                            <media>
                                <audio>
                                    <channelcount>${file.tech_metadata?.channels || 2}</channelcount>
                                </audio>
                            </media>
                        </file>
                        <sourcetrack>
                            <mediatype>audio</mediatype>
                            <trackindex>1</trackindex>
                        </sourcetrack>
                        <filter>
                            <enabled>TRUE</enabled>
                            <start>0</start>
                            <end>${clipDuration}</end>
                            <effect>
                                <name>Audio Levels</name>
                                <effectid>audiolevels</effectid>
                                <effecttype>audiolevels</effecttype>
                                <mediatype>audio</mediatype>
                                <effectcategory>audiolevels</effectcategory>
                                <parameter>
                                    <name>Level</name>
                                    <parameterid>level</parameterid>
                                    <value>1</value>
                                    <valuemin>1e-05</valuemin>
                                    <valuemax>31.6228</valuemax>
                                </parameter>
                            </effect>
                        </filter>
                        <filter>
                            <enabled>TRUE</enabled>
                            <start>0</start>
                            <end>${clipDuration}</end>
                            <effect>
                                <name>Audio Pan</name>
                                <effectid>audiopan</effectid>
                                <effecttype>audiopan</effecttype>
                                <mediatype>audio</mediatype>
                                <effectcategory>audiopan</effectcategory>
                                <parameter>
                                    <name>Pan</name>
                                    <parameterid>pan</parameterid>
                                    <value>0</value>
                                    <valuemin>-1</valuemin>
                                    <valuemax>1</valuemax>
                                </parameter>
                            </effect>
                        </filter>
                        <comments/>
                    </clipitem>
                    <enabled>TRUE</enabled>
                    <locked>FALSE</locked>
                </track>`;
    });

    xml += `
            </audio>
        </media>
    </sequence>
</xmeml>`;

    return xml;
  };

  const downloadXML = (xmlContent: string, filename: string = "StoryGraph_Final_Sync.xml") => {
    const blob = new Blob([xmlContent], { type: 'text/xml' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = filename;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
  };

  return { generateXML, downloadXML };
};
