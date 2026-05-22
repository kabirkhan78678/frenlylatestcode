// import multer from 'multer';

// const storage = multer.diskStorage({
//     destination: (req, file, cb) => {
//         cb(null, 'public/post/');
//     },
//     filename: (req, file, cb) => {
//         cb(null, Date.now() + '-' + file.originalname);
//     },
// });

// export const postUpload = multer({ storage: storage });

import multer from 'multer';

const storage = multer.memoryStorage();



export const postUpload = multer({ storage: storage });