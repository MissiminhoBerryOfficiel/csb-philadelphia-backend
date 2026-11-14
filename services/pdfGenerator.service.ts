import puppeteer from 'puppeteer';
import { PrismaClient, Trimester } from '@prisma/client';

const prisma = new PrismaClient();

export class PdfGeneratorService {
  public static async generateReportCardPdf(studentId: string, trimester: Trimester): Promise<Buffer> {
    const student = await prisma.student.findUnique({
      where: { id: studentId },
      include: {
        class: {
          include: {
            academicYear: true,
            students: true
          }
        },
        grades: {
          where: { trimester },
          include: { subject: true }
        },
        reportCards: {
          where: { trimester }
        }
      }
    });

    if (!student || student.reportCards.length === 0) {
      throw new Error('Bulletin introuvable ou non encore consolidé.');
    }

    const report = student.reportCards[0];
    const effectif = student.class.students.length;

    const rowsHtml = student.grades.map(g => {
      const interro = g.interrogation !== null ? g.interrogation.toFixed(2) : '-';
      const d1 = g.devoir1 !== null ? g.devoir1.toFixed(2) : '-';
      const d2 = g.devoir2 !== null ? g.devoir2.toFixed(2) : '-';
      const moy = g.calculatedMoy !== null ? g.calculatedMoy.toFixed(2) : '-';
      const moyCoef = g.calculatedMoy !== null ? (g.calculatedMoy * g.subject.coefficient).toFixed(2) : '-';

      return `
        <tr>
          <td class="text-left font-bold">${g.subject.name}</td>
          <td>${g.subject.coefficient}</td>
          <td>${interro}</td>
          <td>${d1}</td>
          <td>${d2}</td>
          <td class="font-bold">${moy}</td>
          <td class="font-bold">${moyCoef}</td>
          <td>-</td>
          <td class="text-xs italic">${g.appreciation || ''}</td>
        </tr>
      `;
    }).join('');

    const htmlContent = `
    <!DOCTYPE html>
    <html lang="fr">
    <head>
      <meta charset="UTF-8">
      <style>
        @page {
          size: A4 portrait;
          margin: 0;
        }
        body {
          margin: 0;
          padding: 12mm 15mm;
          font-family: 'Helvetica Neue', Helvetica, Arial, sans-serif;
          color: #0f172a;
          position: relative;
          background: #ffffff;
          box-sizing: border-box;
          -webkit-print-color-adjust: exact;
        }

        /* FILIGRANE CENTRAL CSB PHILADELPHIA */
        .watermark {
          position: fixed;
          top: 48%;
          left: 50%;
          transform: translate(-50%, -50%) rotate(-35deg);
          font-size: 58pt;
          font-weight: 900;
          color: rgba(15, 23, 42, 0.05);
          text-align: center;
          white-space: nowrap;
          pointer-events: none;
          z-index: 0;
          letter-spacing: 5px;
        }

        .content {
          position: relative;
          z-index: 1;
        }

        .header {
          display: flex;
          justify-content: space-between;
          align-items: center;
          border-bottom: 2px solid #0f2744;
          padding-bottom: 8px;
        }
        .header-left {
          text-align: center;
          font-size: 8.5pt;
          font-weight: bold;
        }
        .header-center {
          text-align: center;
        }
        .header-center h1 {
          margin: 0;
          font-size: 14pt;
          color: #0f2744;
          text-transform: uppercase;
          font-weight: 900;
          letter-spacing: 0.5px;
        }
        .sub-name {
          font-size: 10pt;
          color: #b45309;
          font-weight: 800;
        }
        .address {
          font-size: 7.5pt;
          color: #475569;
          margin-top: 2px;
        }

        .title-box {
          text-align: center;
          margin: 10px 0;
        }
        .title-box span {
          background-color: #0f2744;
          color: #ffffff;
          padding: 4px 24px;
          border-radius: 4px;
          font-size: 11pt;
          font-weight: bold;
          letter-spacing: 1px;
        }

        .student-card {
          width: 100%;
          border: 1px solid #cbd5e1;
          border-radius: 4px;
          padding: 6px 12px;
          font-size: 9pt;
          margin-bottom: 10px;
          display: grid;
          grid-template-columns: 2fr 1fr 1fr;
          row-gap: 4px;
          background-color: rgba(248, 250, 252, 0.7);
        }

        table {
          width: 100%;
          border-collapse: collapse;
          font-size: 8pt;
          margin-bottom: 8px;
        }
        th, td {
          border: 1px solid #94a3b8;
          padding: 4px 5px;
          text-align: center;
        }
        th {
          background-color: #1e3a5f;
          color: #ffffff;
          font-weight: bold;
          text-transform: uppercase;
          font-size: 7.5pt;
        }
        td.text-left {
          text-align: left;
        }

        .summary-container {
          display: grid;
          grid-template-columns: 1fr 1fr;
          gap: 10px;
          margin-top: 6px;
        }
        .summary-box {
          border: 1px solid #94a3b8;
          border-radius: 4px;
          padding: 6px;
          font-size: 8.5pt;
        }
        .summary-title {
          font-weight: bold;
          color: #0f2744;
          border-bottom: 1px solid #cbd5e1;
          padding-bottom: 2px;
          margin-bottom: 4px;
          text-transform: uppercase;
          font-size: 8pt;
        }

        .footer-signatures {
          display: grid;
          grid-template-columns: 1fr 1fr;
          gap: 15px;
          margin-top: 10px;
          font-size: 8pt;
        }
        .sign-card {
          border: 1px solid #94a3b8;
          height: 75px;
          padding: 4px;
          border-radius: 4px;
        }
      </style>
    </head>
    <body>
      <div class="watermark">CSB PHILADELPHIA</div>

      <div class="content">
        <div class="header">
          <div class="header-left">
            RÉPUBLIQUE DU BÉNIN<br>
            MINISTÈRE DES ENSEIGNEMENTS<br>
            SECONDAIRE, TECHNIQUE ET DE LA FORMATION PROFESSIONNELLE
          </div>
          <div class="header-center">
            <h1>Complexe Scolaire Bilingue Philadelphia</h1>
            <div class="sub-name">CSB PHILADELPHIA</div>
            <div class="address">Golo-Lohoussa (Abomey-Calavi) • 09 BP 238 Cotonou • Tél: +229 97 00 00 00</div>
          </div>
          <div class="header-left">
            ANNÉE SCOLAIRE<br>
            <strong>${student.class.academicYear.name}</strong>
          </div>
        </div>

        <div class="title-box">
          <span>BULLETIN DU ${trimester === 'T1' ? '1ER' : trimester === 'T2' ? '2ÈME' : '3ÈME'} TRIMESTRE</span>
        </div>

        <div class="student-card">
          <div>Nom & Prénoms : <strong>${student.lastName} ${student.firstName}</strong></div>
          <div>Matricule : <strong>${student.matricule}</strong></div>
          <div>Sexe : <strong>${student.gender}</strong></div>
          <div>Classe : <strong>${student.class.name}</strong></div>
          <div>Effectif : <strong>${effectif}</strong></div>
          <div>Statut : <strong>${student.isRepeating ? 'Redoublant' : 'Non Redoublant'}</strong></div>
        </div>

        <table>
          <thead>
            <tr>
              <th style="width: 25%;">Disciplines</th>
              <th style="width: 6%;">Coef</th>
              <th style="width: 8%;">Moy. Int</th>
              <th style="width: 8%;">Dev 1</th>
              <th style="width: 8%;">Dev 2</th>
              <th style="width: 9%;">Moy. Trim</th>
              <th style="width: 9%;">Moy. Coef</th>
              <th style="width: 6%;">Rang</th>
              <th style="width: 21%;">Appréciations</th>
            </tr>
          </thead>
          <tbody>
            ${rowsHtml}
          </tbody>
        </table>

        <div class="summary-container">
          <div class="summary-box">
            <div class="summary-title">Bilan du Trimestre</div>
            <div>Total Coefficients : <strong>${report.totalCoeff}</strong></div>
            <div>Total Points : <strong>${report.totalPoints.toFixed(2)}</strong></div>
            <div>Moyenne Trimestrielle : <strong style="font-size: 11pt; color: #0f2744;">${report.trimesterMoy.toFixed(2)} / 20</strong></div>
            <div>Rang : <strong>${report.rank} ${report.rank === 1 ? 'er' : 'ème'} sur ${effectif}</strong></div>
            <div>Plus forte moyenne : <strong>${report.highestMoy.toFixed(2)}</strong> | Plus faible : <strong>${report.lowestMoy.toFixed(2)}</strong></div>
          </div>

          <div class="summary-box">
            <div class="summary-title">Mentions & Bilan Annuel</div>
            <div>Distinction : <strong>${report.distinction || 'NÉANT'}</strong></div>
            <div>Moy. T1 : <strong>${report.moyT1 ? report.moyT1.toFixed(2) : '-'}</strong> | Moy. T2 : <strong>${report.moyT2 ? report.moyT2.toFixed(2) : '-'}</strong> | Moy. T3 : <strong>${report.moyT3 ? report.moyT3.toFixed(2) : '-'}</strong></div>
            <div>Moyenne Annuelle : <strong>${report.annualMoy ? report.annualMoy.toFixed(2) : '-'}</strong></div>
            <div>Assiduité / Conduite : <strong>Très Bonne</strong></div>
          </div>
        </div>

        <div class="footer-signatures">
          <div class="sign-card">
            <strong>Observations du Chef d'Établissement :</strong><br>
            <span class="italic" style="font-size: 7.5pt;">${report.headAppreciation || 'Travail satisfaisant. Persévérez dans cet élan.'}</span>
          </div>
          <div class="sign-card" style="text-align: right; padding-right: 15px;">
            Fait à Cotonou, le ${new Date().toLocaleDateString('fr-FR')}<br><br>
            <strong>Le Directeur Général,</strong>
          </div>
        </div>
      </div>
    </body>
    </html>
    `;

    const browser = await puppeteer.launch({
      headless: true,
      args: ['--no-sandbox', '--disable-setuid-sandbox']
    });

    const page = await browser.newPage();
    await page.setContent(htmlContent, { waitUntil: 'networkidle0' });

    const pdfBuffer = await page.pdf({
      format: 'A4',
      printBackground: true,
      preferCSSPageSize: true
    });

    await browser.close();
    return Buffer.from(pdfBuffer);
  }
}