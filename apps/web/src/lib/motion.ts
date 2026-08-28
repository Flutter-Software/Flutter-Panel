export const MOTION_STORAGE_KEY = "flutter-motion";
export const REDUCE_MOTION_ATTR = "data-reduce-motion";

export const MOTION_BOOTSTRAP_SCRIPT = `(function(){try{var s=localStorage.getItem("${MOTION_STORAGE_KEY}");var off=s==="off"||(s!=="on"&&window.matchMedia("(prefers-reduced-motion: reduce)").matches);document.documentElement.setAttribute("${REDUCE_MOTION_ATTR}",off?"off":"on");}catch(e){}})();`;
