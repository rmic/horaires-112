import * as React from "react";
import { cn } from "@/lib/utils";

function Table({ className, ...props }: React.ComponentProps<"table">) {
  return <table className={cn("w-full border-collapse text-sm", className)} {...props} />;
}

function TableHead({ className, ...props }: React.ComponentProps<"th">) {
  return (
    <th
      className={cn("border-b border-slate-200 px-3 py-2 text-left text-xs font-semibold uppercase text-slate-500", className)}
      {...props}
    />
  );
}

function TableCell({ className, ...props }: React.ComponentProps<"td">) {
  return <td className={cn("border-b border-slate-100 px-3 py-2 text-slate-700", className)} {...props} />;
}

export { Table, TableHead, TableCell };
