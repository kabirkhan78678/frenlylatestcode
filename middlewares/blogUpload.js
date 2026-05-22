// import multer from 'multer';

// const storage = multer.diskStorage({
//     destination: (req, file, cb) => {
//         cb(null, 'public/blog/');
//     },
//     filename: (req, file, cb) => {
//         cb(null, Date.now() + '-' + file.originalname);
//     },
// });

// export const blogUpload = multer({ storage: storage });

import multer from 'multer';

const storage = multer.memoryStorage();



export const blogUpload = multer({ storage: storage });