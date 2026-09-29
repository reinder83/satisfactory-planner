// The printed storage room (public/storage-room.ts): bays A–R and their containers. Every
// profile's storage room is built from it (#388), so saved slot-<address> checks and notes and
// every storageEdits field keep pointing at the same addresses.

// A bay of the printed room; items are its containers ('A01'…), name null when empty.
export interface PrintedBay {
  id: string;
  name: string;
  floor: string;
  items: { id: string; name: string | null }[];
}
