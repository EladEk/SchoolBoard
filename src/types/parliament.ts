export type ParliamentDate = {
  id: string;
  title: string;
  date: any; // Firebase Timestamp
  isOpen: boolean;
  createdAt?: any;
  createdByUid?: string;
  createdByName?: string;
};

export type ParliamentSubject = {
  id: string;
  title: string;
  description: string;
  createdByUid: string;
  createdByName: string;
  createdAt: any;
  status: 'pending' | 'approved' | 'rejected';
  statusReason?: string;
  dateId: string;
  dateTitle: string;
  notesCount?: number;
};

export type ParliamentNote = {
  id: string;
  text: string;
  createdAt: any;
  createdByUid: string;
  createdByName: string;
};
