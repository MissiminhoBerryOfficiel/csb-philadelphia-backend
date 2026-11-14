import { PrismaClient, Trimester } from '@prisma/client';

const prisma = new PrismaClient();

export class GradeCalculationService {
  /**
   * Calcule la note finale d'une discipline : (Interro + Dev1 + 2*Dev2) / 4
   */
  public static calculateSubjectAverage(interro: number | null, d1: number | null, d2: number | null): number | null {
    const validScores: { val: number; weight: number }[] = [];
    if (interro !== null && !isNaN(interro)) validScores.push({ val: interro, weight: 1 });
    if (d1 !== null && !isNaN(d1)) validScores.push({ val: d1, weight: 1 });
    if (d2 !== null && !isNaN(d2)) validScores.push({ val: d2, weight: 2 });

    if (validScores.length === 0) return null;

    const totalWeight = validScores.reduce((sum, item) => sum + item.weight, 0);
    const sumPoints = validScores.reduce((sum, item) => sum + item.val * item.weight, 0);
    return parseFloat((sumPoints / totalWeight).toFixed(2));
  }

  /**
   * Réévalue l'ensemble des moyennes et classements d'une classe pour un trimestre
   */
  public static async recalculateClassTrimester(classId: string, trimester: Trimester) {
    const students = await prisma.student.findMany({
      where: { classId },
      include: {
        grades: {
          where: { trimester },
          include: { subject: true }
        }
      }
    });

    const studentSummaries: { studentId: string; moy: number; totalPoints: number; totalCoeff: number }[] = [];

    for (const student of students) {
      let totalPoints = 0;
      let totalCoeff = 0;

      for (const grade of student.grades) {
        const avg = this.calculateSubjectAverage(grade.interrogation, grade.devoir1, grade.devoir2);
        
        await prisma.grade.update({
          where: { id: grade.id },
          data: { calculatedMoy: avg }
        });

        if (avg !== null) {
          totalPoints += avg * grade.subject.coefficient;
          totalCoeff += grade.subject.coefficient;
        }
      }

      const trimMoy = totalCoeff > 0 ? parseFloat((totalPoints / totalCoeff).toFixed(2)) : 0;
      studentSummaries.push({ studentId: student.id, moy: trimMoy, totalPoints, totalCoeff });
    }

    const sortedStudents = [...studentSummaries].sort((a, b) => b.moy - a.moy);
    const highestMoy = sortedStudents.length > 0 ? sortedStudents[0].moy : 0;
    const lowestMoy = sortedStudents.length > 0 ? sortedStudents[sortedStudents.length - 1].moy : 0;
    const classAvg = sortedStudents.length > 0 
      ? parseFloat((sortedStudents.reduce((acc, curr) => acc + curr.moy, 0) / sortedStudents.length).toFixed(2))
      : 0;

    for (let index = 0; index < sortedStudents.length; index++) {
      const summary = sortedStudents[index];
      const rank = index + 1;

      let distinction = 'PASSABLE';
      if (summary.moy >= 16) distinction = 'TABLEAU D\'HONNEUR AVEC FÉLICITATIONS';
      else if (summary.moy >= 14) distinction = 'TABLEAU D\'HONNEUR AVEC ENCOURAGEMENTS';
      else if (summary.moy >= 12) distinction = 'TABLEAU D\'HONNEUR';

      await prisma.reportCard.upsert({
        where: {
          studentId_trimester: {
            studentId: summary.studentId,
            trimester
          }
        },
        create: {
          studentId: summary.studentId,
          trimester,
          totalCoeff: summary.totalCoeff,
          totalPoints: summary.totalPoints,
          trimesterMoy: summary.moy,
          rank,
          highestMoy,
          lowestMoy,
          classMoy: classAvg,
          distinction
        },
        update: {
          totalCoeff: summary.totalCoeff,
          totalPoints: summary.totalPoints,
          trimesterMoy: summary.moy,
          rank,
          highestMoy,
          lowestMoy,
          classMoy: classAvg,
          distinction
        }
      });
    }
  }
}