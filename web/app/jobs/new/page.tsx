import { PostJob } from "./PostJob";

export const metadata = {
  title: "Post a job · Yaadly",
  description:
    "Tell us what needs doing on your property in Jamaica. Free, no account needed to get a quote, and a person reads it within one working day.",
};

export default async function NewJob({
  searchParams,
}: {
  searchParams: Promise<{ trade?: string }>;
}) {
  /* ?trade= comes off the one tap trade tiles on the marketing site, so
     somebody who has already said "roof and zinc" is not asked again. */
  const { trade } = await searchParams;
  return (
    <div className="mx-auto max-w-[1080px] px-5 py-10">
      <PostJob initialTrade={trade} />
    </div>
  );
}
