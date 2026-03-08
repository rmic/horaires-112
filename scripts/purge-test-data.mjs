import "dotenv/config";
import { PrismaClient } from "@prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";
import { createInterface } from "node:readline/promises";
import { stdin as input, stdout as output } from "node:process";

const connectionString = process.env.DATABASE_URL;

if (!connectionString) {
  throw new Error("DATABASE_URL est requis.");
}

const adapter = new PrismaPg({
  connectionString,
});
const prisma = new PrismaClient({ adapter });

const args = new Set(process.argv.slice(2));
const dryRun = args.has("--dry-run");
const forceYes = args.has("--yes");

function unique(values) {
  return [...new Set(values)];
}

function monthLabel(month) {
  return `${String(month.month).padStart(2, "0")}/${month.year}`;
}

function parseMonthSuffix(name) {
  const match = name.match(/E2E (\d{4})-(\d{2})$/);
  if (!match) {
    return null;
  }

  return {
    year: Number(match[1]),
    month: Number(match[2]),
  };
}

async function confirmDeletion(summary) {
  if (forceYes || dryRun) {
    return true;
  }

  if (!process.stdin.isTTY) {
    console.error("Confirmation interactive impossible hors terminal. Relance avec --yes.");
    return false;
  }

  const rl = createInterface({ input, output });

  try {
    const answer = await rl.question(
      `Supprimer ${summary.volunteerCount} volontaires E2E et ${summary.monthCount} mois liés ? Tapez yes pour confirmer: `,
    );
    return answer.trim().toLowerCase() === "yes";
  } finally {
    rl.close();
  }
}

async function main() {
  const volunteers = await prisma.volunteer.findMany({
    orderBy: {
      name: "asc",
    },
  });

  const testVolunteers = volunteers.filter((volunteer) => volunteer.name.includes("E2E"));
  const volunteerIds = testVolunteers.map((volunteer) => volunteer.id);

  if (volunteerIds.length === 0) {
    console.log("Aucune donnée de test E2E détectée.");
    return;
  }

  const [availabilities, assignments, volunteerSettings, notes] = await Promise.all([
    prisma.availability.findMany({
      where: {
        volunteerId: {
          in: volunteerIds,
        },
      },
      select: {
        id: true,
        planningMonthId: true,
      },
    }),
    prisma.assignment.findMany({
      where: {
        volunteerId: {
          in: volunteerIds,
        },
      },
      select: {
        id: true,
        planningMonthId: true,
      },
    }),
    prisma.volunteerMonthSetting.findMany({
      where: {
        volunteerId: {
          in: volunteerIds,
        },
      },
      select: {
        id: true,
        planningMonthId: true,
      },
    }),
    prisma.note.findMany({
      where: {
        volunteerId: {
          in: volunteerIds,
        },
      },
      select: {
        id: true,
        planningMonthId: true,
      },
    }),
  ]);

  const suffixMonths = unique(
    testVolunteers
      .map((volunteer) => parseMonthSuffix(volunteer.name))
      .filter((value) => Boolean(value))
      .map((value) => `${value.year}-${String(value.month).padStart(2, "0")}`),
  ).map((value) => {
    const [year, month] = value.split("-");
    return {
      year: Number(year),
      month: Number(month),
    };
  });

  const relationMonthIds = unique([
    ...availabilities.map((row) => row.planningMonthId),
    ...assignments.map((row) => row.planningMonthId),
    ...volunteerSettings.map((row) => row.planningMonthId),
    ...notes.map((row) => row.planningMonthId),
  ]);

  const suffixMonthRows =
    suffixMonths.length > 0
      ? await prisma.planningMonth.findMany({
          where: {
            OR: suffixMonths.map((value) => ({
              year: value.year,
              month: value.month,
            })),
          },
          select: {
            id: true,
            year: true,
            month: true,
            status: true,
          },
        })
      : [];

  const futureTestMonths = await prisma.planningMonth.findMany({
    where: {
      year: {
        gte: 2030,
      },
    },
    select: {
      id: true,
      year: true,
      month: true,
      status: true,
      availabilities: {
        select: {
          volunteerId: true,
        },
      },
      assignments: {
        select: {
          volunteerId: true,
        },
      },
      volunteerSettings: {
        select: {
          volunteerId: true,
        },
      },
      notes: {
        select: {
          volunteerId: true,
        },
      },
      employeeBlocks: {
        select: {
          id: true,
        },
      },
    },
  });

  const inferredFutureTestMonthIds = futureTestMonths
    .filter((month) => {
      const relatedVolunteerIds = unique([
        ...month.availabilities.map((row) => row.volunteerId),
        ...month.assignments.map((row) => row.volunteerId),
        ...month.volunteerSettings.map((row) => row.volunteerId),
        ...month.notes.map((row) => row.volunteerId).filter((value) => Boolean(value)),
      ]);

      const onlyTestVolunteers =
        relatedVolunteerIds.length > 0 &&
        relatedVolunteerIds.every((volunteerId) => volunteerIds.includes(volunteerId));

      const emptyFutureMonth =
        relatedVolunteerIds.length === 0 &&
        month.notes.length === 0 &&
        month.employeeBlocks.length === 0;

      return onlyTestVolunteers || emptyFutureMonth;
    })
    .map((month) => month.id);

  const targetMonthIds = unique([
    ...relationMonthIds,
    ...suffixMonthRows.map((month) => month.id),
    ...inferredFutureTestMonthIds,
  ]);

  const [months, assignmentEvents] = await Promise.all([
    targetMonthIds.length > 0
      ? prisma.planningMonth.findMany({
          where: {
            id: {
              in: targetMonthIds,
            },
          },
          select: {
            id: true,
            year: true,
            month: true,
            status: true,
          },
          orderBy: [{ year: "asc" }, { month: "asc" }],
        })
      : Promise.resolve([]),
    assignments.length > 0
      ? prisma.assignmentEvent.findMany({
          where: {
            assignmentId: {
              in: assignments.map((assignment) => assignment.id),
            },
          },
          select: {
            id: true,
          },
        })
      : Promise.resolve([]),
  ]);

  const summary = {
    volunteerCount: testVolunteers.length,
    monthCount: months.length,
    availabilityCount: availabilities.length,
    assignmentCount: assignments.length,
    volunteerSettingCount: volunteerSettings.length,
    noteCount: notes.length,
    assignmentEventCount: assignmentEvents.length,
  };

  console.log("Volontaires test détectés:");
  for (const volunteer of testVolunteers) {
    console.log(`- ${volunteer.name}`);
  }

  if (months.length > 0) {
    console.log("\nMois liés qui seront supprimés:");
    for (const month of months) {
      console.log(`- ${monthLabel(month)} (${month.status})`);
    }
  } else {
    console.log("\nAucun mois lié détecté.");
  }

  console.log("\nRésumé:");
  console.log(`- Volontaires: ${summary.volunteerCount}`);
  console.log(`- Mois: ${summary.monthCount}`);
  console.log(`- Disponibilités: ${summary.availabilityCount}`);
  console.log(`- Gardes: ${summary.assignmentCount}`);
  console.log(`- Plafonds mensuels: ${summary.volunteerSettingCount}`);
  console.log(`- Notes: ${summary.noteCount}`);
  console.log(`- Événements de garde: ${summary.assignmentEventCount}`);

  if (dryRun) {
    console.log("\nDry-run uniquement: aucune suppression effectuée.");
    return;
  }

  const confirmed = await confirmDeletion(summary);
  if (!confirmed) {
    console.log("Suppression annulée.");
    return;
  }

  await prisma.$transaction(async (tx) => {
    if (assignmentEvents.length > 0) {
      await tx.assignmentEvent.deleteMany({
        where: {
          id: {
            in: assignmentEvents.map((event) => event.id),
          },
        },
      });
    }

    if (months.length > 0) {
      await tx.planningMonth.deleteMany({
        where: {
          id: {
            in: months.map((month) => month.id),
          },
        },
      });
    }

    await tx.note.deleteMany({
      where: {
        volunteerId: {
          in: volunteerIds,
        },
      },
    });

    await tx.volunteerMonthSetting.deleteMany({
      where: {
        volunteerId: {
          in: volunteerIds,
        },
      },
    });

    await tx.availability.deleteMany({
      where: {
        volunteerId: {
          in: volunteerIds,
        },
      },
    });

    await tx.assignment.deleteMany({
      where: {
        volunteerId: {
          in: volunteerIds,
        },
      },
    });

    await tx.volunteer.deleteMany({
      where: {
        id: {
          in: volunteerIds,
        },
      },
    });
  });

  console.log("\nPurge terminée.");
}

main()
  .catch((error) => {
    console.error("Échec de la purge:", error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
