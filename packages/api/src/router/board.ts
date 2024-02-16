import { TRPCError } from "@trpc/server";
import superjson from "superjson";

import type { Database, SQL } from "@homarr/db";
import { and, createId, eq, inArray } from "@homarr/db";
import {
  boards,
  integrationItems,
  items,
  sections,
} from "@homarr/db/schema/sqlite";
import type { WidgetKind } from "@homarr/definitions";
import { widgetKinds } from "@homarr/definitions";
import {
  createSectionSchema,
  sharedItemSchema,
  validation,
  z,
} from "@homarr/validation";

import { zodUnionFromArray } from "../../../validation/src/enums";
import type { WidgetComponentProps } from "../../../widgets/src/definition";
import { createTRPCRouter, publicProcedure } from "../trpc";

const filterAddedItems = <TInput extends { id: string }>(
  inputArray: TInput[],
  dbArray: TInput[],
) =>
  inputArray.filter(
    (inputItem) => !dbArray.some((dbItem) => dbItem.id === inputItem.id),
  );

const filterRemovedItems = <TInput extends { id: string }>(
  inputArray: TInput[],
  dbArray: TInput[],
) =>
  dbArray.filter(
    (dbItem) => !inputArray.some((inputItem) => dbItem.id === inputItem.id),
  );

const filterUpdatedItems = <TInput extends { id: string }>(
  inputArray: TInput[],
  dbArray: TInput[],
) =>
  inputArray.filter((inputItem) =>
    dbArray.some((dbItem) => dbItem.id === inputItem.id),
  );

export const boardRouter = createTRPCRouter({
  getAll: publicProcedure.query(async ({ ctx }) => {
    return await ctx.db.query.boards.findMany({
      columns: {
        id: true,
        name: true,
      },
      with: {
        sections: {
          with: {
            items: true,
          },
        },
      },
    });
  }),
  create: publicProcedure
    .input(validation.board.create)
    .mutation(async ({ ctx, input }) => {
      const boardId = createId();
      await ctx.db.transaction(async (transaction) => {
        await transaction.insert(boards).values({
          id: boardId,
          name: input.name,
        });
        await transaction.insert(sections).values({
          id: createId(),
          kind: "empty",
          position: 0,
          boardId,
        });
      });
    }),
  delete: publicProcedure
    .input(z.object({ id: z.string() }))
    .mutation(async ({ ctx, input }) => {
      await ctx.db.delete(boards).where(eq(boards.id, input.id));
    }),
  default: publicProcedure.query(async ({ ctx }) => {
    return await getFullBoardWithWhere(ctx.db, eq(boards.name, "default"));
  }),
  byName: publicProcedure
    .input(validation.board.byName)
    .query(async ({ input, ctx }) => {
      return await getFullBoardWithWhere(ctx.db, eq(boards.name, input.name));
    }),
  saveGeneralSettings: publicProcedure
    .input(validation.board.saveGeneralSettings)
    .mutation(async ({ ctx, input }) => {
      const board = await ctx.db.query.boards.findFirst({
        where: eq(boards.id, input.boardId),
      });

      if (!board) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "Board not found",
        });
      }

      await ctx.db
        .update(boards)
        .set({
          pageTitle: input.pageTitle,
          metaTitle: input.metaTitle,
          logoImageUrl: input.logoImageUrl,
          faviconImageUrl: input.faviconImageUrl,
        })
        .where(eq(boards.id, input.boardId));
    }),
  save: publicProcedure
    .input(validation.board.save)
    .mutation(async ({ input, ctx }) => {
      await ctx.db.transaction(async (tx) => {
        const dbBoard = await getFullBoardWithWhere(
          tx,
          eq(boards.id, input.boardId),
        );

        const addedSections = filterAddedItems(
          input.sections,
          dbBoard.sections,
        );

        if (addedSections.length > 0) {
          await tx.insert(sections).values(
            addedSections.map((section) => ({
              id: section.id,
              kind: section.kind,
              position: section.position,
              name: "name" in section ? section.name : null,
              boardId: dbBoard.id,
            })),
          );
        }

        const inputItems = input.sections.flatMap((section) =>
          section.items.map((item) => ({ ...item, sectionId: section.id })),
        );
        const dbItems = dbBoard.sections.flatMap((section) =>
          section.items.map((item) => ({ ...item, sectionId: section.id })),
        );

        const addedItems = filterAddedItems(inputItems, dbItems);

        if (addedItems.length > 0) {
          await tx.insert(items).values(
            addedItems.map((item) => ({
              id: item.id,
              kind: item.kind,
              height: item.height,
              width: item.width,
              xOffset: item.xOffset,
              yOffset: item.yOffset,
              options: superjson.stringify(item.options),
              sectionId: item.sectionId,
            })),
          );
        }

        const inputIntegrationRelations = inputItems.flatMap(
          ({ integrations, id: itemId }) =>
            integrations.map((integration) => ({
              integrationId: integration.id,
              itemId,
            })),
        );
        const dbIntegrationRelations = dbItems.flatMap(
          ({ integrations, id: itemId }) =>
            integrations.map((integration) => ({
              integrationId: integration.id,
              itemId,
            })),
        );
        const addedIntegrationRelations = inputIntegrationRelations.filter(
          (inputRelation) =>
            !dbIntegrationRelations.some(
              (dbRelation) =>
                dbRelation.itemId === inputRelation.itemId &&
                dbRelation.integrationId === inputRelation.integrationId,
            ),
        );

        if (addedIntegrationRelations.length > 0) {
          await tx.insert(integrationItems).values(
            addedIntegrationRelations.map((relation) => ({
              itemId: relation.itemId,
              integrationId: relation.integrationId,
            })),
          );
        }

        const updatedItems = filterUpdatedItems(inputItems, dbItems);

        for (const item of updatedItems) {
          await tx
            .update(items)
            .set({
              kind: item.kind,
              height: item.height,
              width: item.width,
              xOffset: item.xOffset,
              yOffset: item.yOffset,
              options: superjson.stringify(item.options),
              sectionId: item.sectionId,
            })
            .where(eq(items.id, item.id));
        }

        const updatedSections = filterUpdatedItems(
          input.sections,
          dbBoard.sections,
        );

        for (const section of updatedSections) {
          const prev = dbBoard.sections.find(
            (dbSection) => dbSection.id === section.id,
          );
          await tx
            .update(sections)
            .set({
              position: section.position,
              name:
                prev?.kind === "category" && "name" in section
                  ? section.name
                  : null,
            })
            .where(eq(sections.id, section.id));
        }

        const removedIntegrationRelations = dbIntegrationRelations.filter(
          (dbRelation) =>
            !inputIntegrationRelations.some(
              (inputRelation) =>
                dbRelation.itemId === inputRelation.itemId &&
                dbRelation.integrationId === inputRelation.integrationId,
            ),
        );

        for (const relation of removedIntegrationRelations) {
          await tx
            .delete(integrationItems)
            .where(
              and(
                eq(integrationItems.itemId, relation.itemId),
                eq(integrationItems.integrationId, relation.integrationId),
              ),
            );
        }

        const removedItems = filterRemovedItems(inputItems, dbItems);

        const itemIds = removedItems.map((item) => item.id);
        if (itemIds.length > 0) {
          await tx.delete(items).where(inArray(items.id, itemIds));
        }

        const removedSections = filterRemovedItems(
          input.sections,
          dbBoard.sections,
        );
        const sectionIds = removedSections.map((section) => section.id);

        if (sectionIds.length > 0) {
          await tx.delete(sections).where(inArray(sections.id, sectionIds));
        }
      });
    }),
});

const getFullBoardWithWhere = async (db: Database, where: SQL<unknown>) => {
  const board = await db.query.boards.findFirst({
    where,
    with: {
      sections: {
        with: {
          items: {
            with: {
              integrations: {
                with: {
                  integration: true,
                },
              },
            },
          },
        },
      },
    },
  });

  if (!board) {
    throw new TRPCError({
      code: "NOT_FOUND",
      message: "Board not found",
    });
  }

  const { sections, ...otherBoardProperties } = board;

  return {
    ...otherBoardProperties,
    sections: sections.map((section) =>
      parseSection({
        ...section,
        items: section.items.map((item) => ({
          ...item,
          integrations: item.integrations.map((item) => item.integration),
          options: superjson.parse<Record<string, unknown>>(item.options),
        })),
      }),
    ),
  };
};

// The following is a bit of a mess, it's providing us typesafe options matching the widget kind.
// But I might be able to do this in a better way in the future.
const forKind = <T extends WidgetKind>(kind: T) =>
  z.object({
    kind: z.literal(kind),
    options: z.custom<Partial<WidgetComponentProps<T>["options"]>>(),
  }) as UnionizeSpecificItemSchemaForWidgetKind<T>;

type SpecificItemSchemaForWidgetKind<TKind extends WidgetKind> = z.ZodObject<{
  kind: z.ZodLiteral<TKind>;
  options: z.ZodType<
    Partial<WidgetComponentProps<TKind>["options"]>,
    z.ZodTypeDef,
    Partial<WidgetComponentProps<TKind>["options"]>
  >;
}>;

type UnionizeSpecificItemSchemaForWidgetKind<T> = T extends WidgetKind
  ? SpecificItemSchemaForWidgetKind<T>
  : never;

const outputItemSchema = zodUnionFromArray(
  widgetKinds.map((kind) => forKind(kind)),
).and(sharedItemSchema);

const parseSection = (section: unknown) => {
  const result = createSectionSchema(outputItemSchema).safeParse(section);
  if (!result.success) {
    throw new Error(result.error.message);
  }
  return result.data;
};