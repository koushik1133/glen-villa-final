import { pageContext } from "@/lib/page-context";
import { mutate } from "@/lib/db";
import { marketingColumns, seedMarketingBoard, seedMarketingCards } from "@/lib/board/seed";
import { TopBar } from "@/components/shell";
import { BoardView } from "@/components/board-view";

export const dynamic = "force-dynamic";

export default async function BoardPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const sp = await searchParams;
  const { db, brand, brandId } = pageContext(sp);

  // Boards are created lazily rather than at bootstrap, so a brand added at any
  // point still gets one on its first visit here.
  //
  // A brand-new board arrives pre-filled from the DEMO SEED in
  // `src/lib/board/seed.ts` — a marketing workflow and sample cards, so the
  // screen shows what it is for instead of five empty columns. The same seed
  // fills a board that already exists but has never held a single card, which
  // is the state a fresh install ships in. A board with any card on it is left
  // exactly as its owner left it: the seed never overwrites real work.
  let board = db.boards.find((b) => b.brandId === brandId);
  let cards = board ? db.boardCards.filter((c) => c.boardId === board!.id) : [];

  if (!board) {
    const seeded = seedMarketingBoard(brandId, `${brand.name} Board`);
    mutate((d) => {
      d.boards.push(seeded.board);
      d.boardCards.push(...seeded.cards);
    });
    board = seeded.board;
    cards = seeded.cards;
  } else if (cards.length === 0) {
    const existing = board;
    const columns = marketingColumns();
    const filled = { ...existing, columns, fields: { ...existing.fields, automationLabel: true } };
    const seededCards = seedMarketingCards(filled);
    mutate((d) => {
      const row = d.boards.find((b) => b.id === existing.id);
      if (!row) return;
      row.columns = columns;
      row.fields = { ...row.fields, automationLabel: true };
      row.templateId = "content";
      row.updatedAt = new Date().toISOString();
      d.boardCards.push(...seededCards);
    });
    board = { ...filled, templateId: "content" };
    cards = seededCards;
  }

  return (
    <>
      <TopBar brands={db.brands} brandId={brandId} title={board.name} subtitle={`${cards.length} cards · ${board.columns.length} columns`} />
      <BoardView board={board} cards={cards} />
    </>
  );
}
