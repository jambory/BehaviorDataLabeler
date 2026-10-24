# Behavior Data Labeler

An Electron desktop app for labeling dog behaviors over a video timeline, with a React editor and bundled FFmpeg/FFprobe. It lives independently of the FoundationModelDogtonomous annotator.

## Run

Requires Node.js 22.12+ (or Node.js 24) and npm. From this folder:

```sh
npm install
npm start
```

`npm start` builds the interface and opens the desktop window. There is no web server, cloud service, Python runtime requirement, or model inference. Internet access is needed to install dependencies, not to label videos.

## Label a video

1. Choose **Open video**. MP4, MOV, MKV, AVI, WebM, M4V and MTS are offered in the picker; actual codec support depends on bundled FFmpeg.
2. A second file explorer asks for a **parent folder**. Choose an existing folder and click **Use This Parent Folder**; you do not need to create a job folder yourself.
3. The app creates `<video-name>_behavior_labels` inside that parent, with a `frames/` subfolder, `<video-name>_labels.pkl`, and `<video-name>_labels.job.json`. No separate labels save dialog is needed. Choose the same parent folder to reuse the completed cache and reload existing labels after validation. Existing jobs can still be reopened from their original `.job.json` locations.
4. Click an empty track to add a one-second label, or click and drag to draw a precise range in either direction. Different behaviors may overlap. Overlapping or adjacent ranges of the same behavior merge.
5. Drag a label to move it; drag either edge to trim. Select a label for exact frame boundaries, behavior changes, **Start here**, **End here**, and deletion. **Add label** adds one second at the playhead on the selected behavior track.
6. Labels auto-save after edits; **Save** / Cmd/Ctrl+S saves immediately. Use **Resume job** and select the `.job.json` to reopen your video, extracted frames and saved labels. **Import existing .pkl labels** replaces the current intervals; undo restores the previous intervals.

The ten tracks are `sit`, `down`, `paw`, `stand`, `bow`, `sit-pretty`, `play-dead`, `roll-over`, `spin`, and `back-up`.

## Layout and playback

Videos start muted. Use the **Mute / Unmute** button in the top-right corner of the video to toggle audio; opening or resuming a video starts muted again.

Video always fits its viewport without stretching or cropping, including portrait, landscape, square and high-resolution media. Paused playback shows the actual full-resolution extracted frame. The playback proxy is capped at 1920 pixels on either axis; source frames keep their original display resolution. Source videos are never modified.

Drag the divider above the timeline to resize it. **Tracks → Fit all** scales rows to the available height, down to a readable minimum. Compact, Comfortable and Expanded set explicit row heights. The timeline scrolls vertically whenever all ten tracks do not fit, and horizontally when zoomed in. Track names stay visible when scrolling horizontally. **Fit** shows the whole video; the **− / +** zoom buttons or slider magnify time so you can drag and trim down to individual frames. The adjacent readout shows the duration visible across the timeline. Zoom keeps the playhead in view; scroll horizontally to reach other sections. During playback the timeline follows the playhead.

| Key | Action |
| --- | --- |
| Space | Play / pause |
| Left / Right | Previous / next frame |
| Shift + Left / Right | Move approximately one second |
| A | Add a label at the playhead |
| Delete / Backspace | Delete selected label |
| Cmd/Ctrl+Z | Undo |
| Cmd/Ctrl+Shift+Z | Redo |
| Cmd/Ctrl+S | Save |
| Cmd/Ctrl+O | Open video |
| Cmd/Ctrl+Shift+O | Resume job |
| + / − | Timeline zoom |
| Escape | Deselect / cancel a drag |

## Files and compatibility

The label output is a plain Python pickle dictionary, matching the supplied `clean_left_paw_labels.pkl` structure:

```python
{
    0: ["sit"],
    1: ["sit", "paw"],
    2: [],
    # ... one key for every extracted frame
}
```

Keys are **zero-based integer frame indices**; values are lists of behavior strings. Unlabeled frames have an empty list. The inspector’s end frame is **exclusive**: `[10, 20)` labels frames 10 through 19. Missing keys in imported sparse label dictionaries count as unlabeled. Out-of-range indices and unknown behaviors are rejected to avoid silently losing data. Imports accept plain dict/list/string/integer pickles using protocols 2–5; they never execute Python pickle globals. Export uses protocol 2 for Python compatibility.

The `.job.json` keeps paths, source fingerprint and frame metadata. The `.pkl` is the label source of truth when resuming. Keep both, the original video, and the frames folder in their saved locations. Paths can be edited in the config if the job is moved; the cache is tied to the original source path, size and modification time. An incomplete or mismatched cache is reported instead of overwritten; choose a new empty output location to regenerate it.

The frame folder contains `frame_00000000.jpg`, subsequent sequential JPEGs, small `thumb_000000.jpg` timeline thumbnails, `playback.mp4`, and `frames.json`. Small thumbnails keep the timeline responsive for high-resolution source videos. Extraction and playback use the same constant frame rate derived from the source. Variable-frame-rate sources are resampled to that rate, so their frame indices refer to the extracted sequence; use a constant-frame-rate source for downstream tools that index the original video directly. Initial extraction can take time and substantial disk space. Completed caches are reused; canceling preparation removes temporary extraction files.

Labels and config are written through temporary files and renamed into place. Closing with unsaved edits prompts to save, cancel, or discard. Changing videos first saves the current edits. Undo/redo keeps up to 100 editing operations in the current session.

## Validate and package

```sh
npm test
npm run build
npm run test:desktop
npm run package:mac
# On Windows:
npm run package:win
```

The core tests cover overlapping labels, frame boundaries, Python pickle interoperability, real portrait-video extraction, proxy frame counts, cache reuse, saved-job reopening, stale caches and cancellation. The desktop smoke test launches a real Electron window, redirects native dialogs to a generated temporary video, and exercises adding, drawing, moving, trimming, undo/redo, stepping, playback, scrolling, autosave and resume. It leaves a screenshot and test data in the temporary folder printed on completion. Core interoperability tests require Python 3; the application itself does not.

Packages are written to `release/`. Build installers on the destination OS so bundled media binaries match. The macOS build is unsigned. Set `FFMPEG_PATH` / `FFPROBE_PATH` to override the bundled binaries if necessary.
