export const ID_ATTR = "data-clicker4jf8-id";

export type UIRequest =
  | { type: "SHOW_THOUGHT"; text: string | null }
  | { type: "MOVE_CURSOR"; id: number }
  | { type: "DO_CLICK"; id: number }
  | { type: "DO_TYPE"; id: number; text: string };

export type UIResponse = { message: string; isError: boolean };

export type SnapshotResult =
  | { success:true, snapshot: string, pageTitle:string, pageUrl:string }
  | { success:false, snapshot: string, pageTitle:string, pageUrl:string, error: string };
