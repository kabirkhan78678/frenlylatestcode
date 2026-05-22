// import multer from 'multer';

// const storage = multer.diskStorage({
//     destination: (req, file, cb) => {
//         cb(null, 'public/vlog/');
//     },
//     filename: (req, file, cb) => {
//         cb(null, Date.now() + '-' + file.originalname);
//     },
// });

// export const vlogUpload = multer({ storage: storage });

import multer from 'multer';

const storage = multer.memoryStorage();



export const vlogUpload = multer({ storage: storage });