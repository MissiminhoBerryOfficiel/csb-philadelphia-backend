import { Router } from 'express';
import { authenticateJWT } from '../middlewares/auth.middleware';
import { PdfGeneratorService } from '../services/pdfGenerator.service';
import { Trimester } from '@prisma/client';

const router = Router();

router.get('/:studentId/pdf/:trimester', authenticateJWT, async (req, res) => {
  try {
    const { studentId, trimester } = req.params;
    const pdfBuffer = await PdfGeneratorService.generateReportCardPdf(
      studentId,
      trimester as Trimester
    );

    res.set({
      'Content-Type': 'application/pdf',
      'Content-Disposition': `attachment; filename=Bulletin_${studentId}_${trimester}.pdf`,
      'Content-Length': pdfBuffer.length,
    });

    res.end(pdfBuffer);
  } catch (error: any) {
    res.status(500).json({ message: 'Erreur génération PDF', error: error.message });
  }
});

export default router;