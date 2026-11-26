// 9. Lister tous les membres du personnel
router.get('/staff', verifyAuth, async (req: Request, res: Response) => {
  try {
    const user = (req as any).user;
    if (user.role !== 'SUPER_ADMIN' && user.role !== 'ADMIN') {
      return res.status(403).json({ message: 'Accès réservé à la Direction.' });
    }
    const staff = await prisma.user.findMany({
      select: {
        id: true,
        matricule: true,
        fullName: true,
        email: true,
        role: true,
        phone: true,
        subjectsTaught: {
          select: {
            subjectId: true,
            subject: {
              select: {
                id: true,
                name: true,
                class: { select: { id: true, name: true } },
              },
            },
          },
        },
      },
      orderBy: { createdAt: 'asc' },
    });
    res.json(staff);
  } catch (error: any) {
    // Secours si subjectsTaught n'est pas encore migré sur Neon
    const fallbackStaff = await prisma.user.findMany({
      select: { id: true, matricule: true, fullName: true, email: true, role: true, phone: true },
      orderBy: { createdAt: 'asc' },
    });
    res.json(fallbackStaff);
  }
});

// 10. Créer un nouveau compte personnel
router.post('/staff', verifyAuth, async (req: Request, res: Response) => {
  try {
    const user = (req as any).user;
    if (user.role !== 'SUPER_ADMIN' && user.role !== 'ADMIN') {
      return res.status(403).json({ message: 'Action réservée au Fondateur ou au Directeur.' });
    }

    const { fullName, email, password, role, phone } = req.body;
    const cleanEmail = email.toLowerCase().trim();

    const existingUser = await prisma.user.findUnique({ where: { email: cleanEmail } });
    if (existingUser) {
      return res.status(400).json({
        message: `L'email "${cleanEmail}" appartient déjà à ${existingUser.fullName}. Cliquez sur le crayon à droite de son nom pour le modifier.`,
      });
    }

    const hashedPassword = await bcrypt.hash(password, 10);
    const uniqueSuffix = String(Date.now()).slice(-5);

    const newStaff = await prisma.user.create({
      data: {
        matricule: `CSB-PERS-${uniqueSuffix}`,
        fullName,
        email: cleanEmail,
        password: hashedPassword,
        role: role || 'TEACHER',
        phone: phone || '',
      },
    });

    res.status(201).json({
      id: newStaff.id,
      matricule: newStaff.matricule,
      fullName: newStaff.fullName,
      email: newStaff.email,
      role: newStaff.role,
      phone: newStaff.phone,
    });
  } catch (error: any) {
    res.status(500).json({
      message: `Erreur serveur (${error?.code || 'DB'}) : vérifiez la synchronisation Prisma/Render.`,
    });
  }
});
