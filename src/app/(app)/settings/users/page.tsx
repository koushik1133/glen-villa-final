import { redirect } from "next/navigation";
import { pageContext } from "@/lib/page-context";
import { TopBar } from "@/components/shell";
import { Card, SectionTitle } from "@/components/ui";
import { getSession, hasPermission } from "@/lib/auth/session";
import { UserAdmin } from "@/components/settings/user-admin";

export const dynamic = "force-dynamic";

/**
 * Admin → Users.
 *
 * The page-access map already refuses this path without `users.manage`, but the
 * check is repeated here rather than assumed. The map is one regex list; a
 * reordering or a typo in it should not be the only thing standing between a
 * sales account and the screen that grants roles.
 */
export default async function UsersPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { db, brandId } = pageContext(await searchParams);
  const session = await getSession();
  if (!session) redirect("/signin");
  if (!hasPermission(session, "users.manage")) redirect("/");

  return (
    <>
      <TopBar brands={db.brands} brandId={brandId} title="Users and roles" subtitle="Who can sign in, and what they may see" />
      <div className="space-y-6 p-4 sm:p-6 lg:p-7">
        <Card>
          <SectionTitle
            title="How access works here"
            hint="A role is a set of permissions; a person holds one role"
          />
          <p className="text-[12px] leading-relaxed text-mist-300">
            Each screen states the permission it requires, and the same check runs
            again on every API route behind it — so changing someone&apos;s role changes
            what they can open <em>and</em> what they can do, not just which links
            appear in their sidebar. Nothing here can grant a permission that the
            role does not already carry.
          </p>
        </Card>

        <UserAdmin selfId={session.userId} />
      </div>
    </>
  );
}
