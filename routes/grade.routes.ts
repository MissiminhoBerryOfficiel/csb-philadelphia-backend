import { Router } from 'express';
import { updateGrades, submitGradesToAdmin, reviewGradesStatus } from '../controllers/grade.controller';
import { authenticateJWT } from '../middlewares/auth.middleware';

const router = Router();

router.use(authenticateJWT);

router.post('/save', updateGrades);
router.post('/submit', submitGradesToAdmin);
router.post('/review', reviewGradesStatus);

export default router;