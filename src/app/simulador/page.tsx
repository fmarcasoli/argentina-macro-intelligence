import { UnderConstruction } from "@/components/ui-kit/under-construction";
import { findSection } from "@/lib/nav";

const section = findSection("/simulador")!;

export const metadata = { title: section.label };

export default function Page() {
  return <UnderConstruction section={section} />;
}
