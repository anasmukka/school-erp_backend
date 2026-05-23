import { Card, CardContent } from "@/components/ui/card";

export type QType = "short" | "mcq" | "long" | "question";

export interface QPQuestion {
  id: string;
  type: QType;
  text: string;
  marks: number;
  imageData?: string;
  options?: [string, string, string, string];
  correctOption?: number;
}

export interface QPSection {
  id: string;
  title: string;
  instructions: string;
  questions: QPQuestion[];
}

/** Placeholder until full Question Paper maker file is restored on this machine. */
export default function QuestionPaper() {
  return (
    <Card className="max-w-lg mx-auto mt-12">
      <CardContent className="pt-8 pb-8 text-center space-y-2">
        <p className="text-lg font-semibold">Question Paper Maker</p>
        <p className="text-sm text-muted-foreground">
          This page file was missing from the project folder. Restore <code>QuestionPaper.tsx</code> from backup
          or version control to use the full editor again.
        </p>
      </CardContent>
    </Card>
  );
}
