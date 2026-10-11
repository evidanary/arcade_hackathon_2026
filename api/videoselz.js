import { asNodeHandler, handleVideoselz } from "../server/handlers.js";

// POST /api/videoselz: hands a finished product to Videoselz and reads its videos.
export default asNodeHandler(handleVideoselz);
