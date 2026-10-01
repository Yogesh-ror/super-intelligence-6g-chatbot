import { isPlatformBrowser } from '@angular/common';
import { afterNextRender, ChangeDetectorRef, Component, PLATFORM_ID, inject } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { CommonModule } from '@angular/common';

interface Message {
  id: string;
  text: string;
  sender: 'user' | 'ai';
  time: string;
}

interface PdfLink {
  url: string;
  label: string;
}

interface MessageBlock {
  type: 'text' | 'code';
  content: string;
  language?: string;
}

interface Conversation {
  id: string;
  title: string;
  updatedAt: number;
  messages: Message[];
}

interface AuthUser {
  email: string;
  name: string;
  isAdmin: boolean;
}

interface AdminUser {
  email: string;
  name: string;
  createdAt: string;
}

@Component({
  selector: 'app-chatbot',
  standalone: true,
  imports: [CommonModule, FormsModule],
  templateUrl: './chatbot.html',
  styleUrl: './chatbot.css'
})
export class Chatbot {
  static getFriendlyErrorMessage(message: string): string {
    const normalized = message.trim();

    if (!normalized) {
      return 'Unable to reach your assistant. Please try again.';
    }

    if (normalized.includes('Assistant service is not configured yet.')) {
      return 'Assistant service is not configured yet.';
    }

    if (normalized.includes('Unable to reach the assistant') || normalized.includes('The assistant returned an empty response')) {
      return 'Unable to reach your assistant. Please check the server connection.';
    }

    return normalized;
  }

  private readonly platformId = inject(PLATFORM_ID);
  private readonly changeDetector = inject(ChangeDetectorRef);

  authMode: 'login' | 'signup' = 'login';
  authEmail = '';
  authName = '';
  authPassword = '';
  authConfirmPassword = '';
  authError = '';
  isSubmittingAuth = false;
  isCheckingSession = false;
  isAuthenticated = false;
  currentUserName = '';
  currentUserEmail = '';
  isAdmin = false;
  adminUsers: AdminUser[] = [];
  showAdminPanel = false;
  showSettings = false;
  enterToSend = true;
  soundEffects = false;
  compactResponses = false;
  language = 'en';
  appearance: 'light' | 'dark' = 'light';
  userMessage = '';
  selectedFiles: File[] = [];
  fileError = '';
  isTyping = false;
  isDeletingChats = false;
  sidebarOpen = false;
  searchQuery = '';
  copiedMessageId = '';
  activeConversationId = 'welcome';

  conversations: Conversation[] = [
    { id: 'welcome', title: 'New conversation', updatedAt: Date.now(), messages: [] }
  ];

  readonly suggestions = [
    { icon: '✳', title: 'Untangle an idea', prompt: 'Help me think through an idea I have.' },
    { icon: '↗', title: 'Write something', prompt: 'Help me write a clear, engaging introduction.' },
    { icon: '⌘', title: 'Learn a concept', prompt: 'Explain a tricky concept in simple terms.' },
    { icon: '◷', title: 'Make a plan', prompt: 'Help me make a practical plan for this week.' }
  ];

  constructor() {
    afterNextRender(() => this.restoreSession());
  }

  get activeConversation(): Conversation {
    return this.conversations.find(conversation => conversation.id === this.activeConversationId)
      ?? this.conversations[0];
  }

  trackById(_index: number, item: { id: string }): string {
    return item.id;
  }

  trackByEmail(_index: number, item: AdminUser): string {
    return item.email;
  }

  get filteredConversations(): Conversation[] {
    const query = this.searchQuery.trim().toLowerCase();
    return [...this.conversations]
      .filter(conversation => !query || conversation.title.toLowerCase().includes(query))
      .sort((first, second) => second.updatedAt - first.updatedAt);
  }

  private async restoreSession(): Promise<void> {
    try {
      const response = await fetch('/api/auth/session', { credentials: 'same-origin' });
      if (response.ok) {
        const result = await response.json() as { user: AuthUser };
        await this.authenticate(result.user);
      }
    } catch {
      this.authError = 'Unable to connect to your account. Please try again.';
    } finally {
      this.isCheckingSession = false;
      this.changeDetector.markForCheck();
    }
  }

  setAuthMode(mode: 'login' | 'signup'): void {
    this.authMode = mode;
    this.authError = '';
    this.authPassword = '';
    this.authConfirmPassword = '';
  }

  async submitAuth(): Promise<void> {
    const email = this.authEmail.trim().toLowerCase();
    const name = this.authName.trim();
    const password = this.authPassword;

    this.authError = '';
    if (!email || !email.includes('@')) {
      this.authError = 'Enter a valid email address.';
      return;
    }
    if (password.length < 8) {
      this.authError = 'Your password must be at least 8 characters.';
      return;
    }
    if (this.authMode === 'signup' && !name) {
      this.authError = 'Tell us your name to create an account.';
      return;
    }
    if (this.authMode === 'signup' && password !== this.authConfirmPassword) {
      this.authError = 'Those passwords do not match.';
      return;
    }

    this.isSubmittingAuth = true;
    try {
      const endpoint = this.authMode === 'signup' ? '/api/auth/signup' : '/api/auth/login';
      const response = await fetch(endpoint, {
        method: 'POST',
        credentials: 'same-origin',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, name, password })
      });
      const result = await response.json() as { user?: AuthUser; error?: string };
      if (!response.ok) {
        if (response.status === 404 && this.authMode === 'login') {
          this.authMode = 'signup';
          this.authError = result.error || 'You have no account yet. Please create an account first.';
          return;
        }
        if (response.status === 409 && this.authMode === 'signup') {
          this.authMode = 'login';
          this.authError = 'An account with that email already exists. Please sign in instead.';
          return;
        }
        throw new Error(result.error || 'Unable to access your account right now.');
      }
      if (!result.user) throw new Error('Unable to access your account right now.');

      await this.authenticate(result.user);
    } catch (error) {
      this.authError = error instanceof Error ? error.message : 'Unable to access your account right now.';
    } finally {
      this.isSubmittingAuth = false;
      this.changeDetector.markForCheck();
    }
  }

  async signOut(): Promise<void> {
    this.persistConversations();
    try {
      await fetch('/api/auth/logout', { method: 'POST', credentials: 'same-origin' });
    } catch {
      // Clear the local view even when the network is unavailable.
    }
    this.isAuthenticated = false;
    this.currentUserName = '';
    this.currentUserEmail = '';
    this.isAdmin = false;
    this.adminUsers = [];
    this.showAdminPanel = false;
    this.showSettings = false;
    this.sidebarOpen = false;
    this.userMessage = '';
  }

  async deleteAllConversations(): Promise<void> {
    if (!isPlatformBrowser(this.platformId) || this.isDeletingChats) return;
    if (!window.confirm('Delete every saved conversation? This cannot be undone.')) return;

    this.isDeletingChats = true;
    try {
      const response = await fetch('/api/conversations', {
        method: 'DELETE',
        credentials: 'same-origin'
      });
      if (!response.ok) throw new Error('Unable to delete your conversations.');

      this.conversations = [{ id: 'welcome', title: 'New conversation', updatedAt: Date.now(), messages: [] }];
      this.activeConversationId = 'welcome';
      this.searchQuery = '';
      this.userMessage = '';
      this.sidebarOpen = false;
    } catch {
      this.authError = 'Unable to delete your conversations. Please try again.';
    } finally {
      this.isDeletingChats = false;
      this.changeDetector.markForCheck();
    }
  }

  startConversation(): void {
    const conversation: Conversation = {
      id: this.createId(),
      title: 'New conversation',
      updatedAt: Date.now(),
      messages: []
    };

    this.conversations.unshift(conversation);
    this.activeConversationId = conversation.id;
    this.sidebarOpen = false;
    this.userMessage = '';
    this.persistConversations();
  }

  selectConversation(id: string): void {
    this.activeConversationId = id;
    this.sidebarOpen = false;
  }

  handleEnter(event: Event): void {
    if ((event as KeyboardEvent).shiftKey || !this.enterToSend) return;
    event.preventDefault();
    this.sendMessage();
  }

  async sendMessage(text = this.userMessage): Promise<void> {
    const baseMessage = text.trim();
    const files = [...this.selectedFiles];
    if (!baseMessage && files.length === 0) return;
    if (this.isTyping) return;
    let fileContext = '';
    try {
      for (const file of files) {
        const contents = await file.text();
        fileContext += `\n\n[Uploaded file: ${file.name}]\n${contents.slice(0, 30000)}`;
      }
    } catch {
      this.fileError = 'Unable to read one of the selected files.';
      return;
    }
    const message = `${baseMessage}${fileContext}`.trim();

    const conversation = this.activeConversation;
    conversation.messages.push({
      id: this.createId(),
      text: message,
      sender: 'user',
      time: this.getTime()
    });
    if (conversation.messages.length === 1) {
      conversation.title = message.length > 34 ? `${message.slice(0, 34).trim()}…` : message;
    }
    conversation.updatedAt = Date.now();
    this.userMessage = '';
    this.selectedFiles = [];
    this.fileError = '';
    this.isTyping = true;
    this.persistConversations();

    try {
      const response = await fetch('/api/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          messages: conversation.messages.slice(-10).map(item => ({
            role: item.sender === 'ai' ? 'model' : 'user',
            text: item.text
          }))
        })
      });
      const result = await response.json() as { reply?: string; error?: string };
      if (!response.ok || !result.reply) {
        throw new Error(result.error || 'Your assistant could not respond. Please try again.');
      }

      const updatedConversation = this.conversations.find(item => item.id === conversation.id);
      updatedConversation?.messages.push({
        id: this.createId(),
        text: result.reply,
        sender: 'ai',
        time: this.getTime()
      });
      if (updatedConversation) updatedConversation.updatedAt = Date.now();
    } catch (error) {
      const updatedConversation = this.conversations.find(item => item.id === conversation.id);
      const friendlyMessage = error instanceof Error
        ? Chatbot.getFriendlyErrorMessage(error.message)
        : 'Unable to reach your assistant. Please try again.';

      updatedConversation?.messages.push({
        id: this.createId(),
        text: friendlyMessage,
        sender: 'ai',
        time: this.getTime()
      });
    } finally {
      this.isTyping = false;
      this.persistConversations();
      this.changeDetector.markForCheck();
    }
  }

  onFilesSelected(event: Event): void {
    const input = event.target as HTMLInputElement;
    const files = Array.from(input.files ?? []);
    const allowed = /\.(txt|md|csv|json|html?|css|js|ts|xml|yaml|yml|log)$/i;
    if (files.some(file => !allowed.test(file.name))) {
      this.fileError = 'Choose text, Markdown, CSV, JSON, HTML, CSS, JavaScript, TypeScript, XML, YAML, or log files.';
    } else if (files.length + this.selectedFiles.length > 5) {
      this.fileError = 'You can attach up to 5 files per message.';
    } else if (files.some(file => file.size > 2_000_000)) {
      this.fileError = 'Each file must be 2 MB or smaller.';
    } else {
      this.selectedFiles = [...this.selectedFiles, ...files];
      this.fileError = '';
    }
    input.value = '';
  }

  removeSelectedFile(index: number): void {
    this.selectedFiles = this.selectedFiles.filter((_, fileIndex) => fileIndex !== index);
    this.fileError = '';
  }

  getPdfLinks(text: string): PdfLink[] {
    const links: PdfLink[] = [];
    const pattern = /(?:\[([^\]]+)\]\((https?:\/\/[^\s)]+\.pdf(?:\?[^\s)]*)?)\)|(https?:\/\/[^\s<>"']+\.pdf(?:\?[^\s<>"']*)?))/gi;
    let match: RegExpExecArray | null;
    while ((match = pattern.exec(text)) !== null) {
      const url = match[2] || match[3];
      if (url && !links.some(link => link.url === url)) {
        links.push({ url, label: match[1] || decodeURIComponent(url.split('/').pop()?.split('?')[0] || 'Download PDF') });
      }
    }
    return links;
  }

  clearConversation(): void {
    this.activeConversation.messages = [];
    this.activeConversation.title = 'New conversation';
    this.activeConversation.updatedAt = Date.now();
    this.persistConversations();
  }

  async copyMessage(message: Message): Promise<void> {
    await this.copyText(message.text, message.id);
  }

  async copyCode(block: MessageBlock, message: Message, index: number): Promise<void> {
    await this.copyText(block.content, `${message.id}-code-${index}`);
  }

  getMessageBlocks(text: string): MessageBlock[] {
    const blocks: MessageBlock[] = [];
    const codePattern = /```([^\n]*)\n([\s\S]*?)```/g;
    let cursor = 0;
    let match: RegExpExecArray | null;

    while ((match = codePattern.exec(text)) !== null) {
      const textBeforeCode = text.slice(cursor, match.index).trim();
      if (textBeforeCode) blocks.push({ type: 'text', content: textBeforeCode });

      blocks.push({
        type: 'code',
        language: match[1].trim() || 'code',
        content: match[2].replace(/^\n+|\n+$/g, '')
      });
      cursor = match.index + match[0].length;
    }

    const remainingText = text.slice(cursor).trim();
    if (remainingText) blocks.push({ type: 'text', content: remainingText });
    return blocks.length ? blocks : [{ type: 'text', content: text }];
  }

  getCleanMessageText(text: string): string {
    return text
      .replace(/^\s*(?:-{3,}|_{3,}|\*{3,})\s*$/gm, '────────────────')
      .replace(/^\s{0,3}#{1,6}\s+/gm, '')
      .replace(/^\s*[-*+]\s+/gm, '• ')
      .replace(/\*\*([^*\n]+)\*\*/g, '$1')
      .replace(/__([^_\n]+)__/g, '$1')
      .replace(/(?<!\*)\*([^*\n]+)\*(?!\*)/g, '$1')
      .replace(/(?<!_)_([^_\n]+)_(?!_)/g, '$1')
      .replace(/~~([^~\n]+)~~/g, '$1')
      .replace(/`([^`\n]+)`/g, '$1')
      .replace(/^\s*>\s?/gm, '')
      .trim();
  }

  private async copyText(text: string, copyId: string): Promise<void> {
    if (!isPlatformBrowser(this.platformId)) return;
    try {
      await navigator.clipboard.writeText(text);
      this.copiedMessageId = copyId;
      setTimeout(() => this.copiedMessageId = '', 1400);
    } catch {
      this.copiedMessageId = '';
    }
  }

  exportConversation(): void {
    if (!isPlatformBrowser(this.platformId) || !this.activeConversation.messages.length) return;
    const transcript = this.activeConversation.messages
      .map(message => `${message.sender === 'user' ? 'You' : 'Super Intelligence 6G'} · ${message.time}\n${message.text}`)
      .join('\n\n');
    const file = new Blob([transcript], { type: 'text/plain;charset=utf-8' });
    const url = URL.createObjectURL(file);
    const link = document.createElement('a');
    link.href = url;
    link.download = `${this.activeConversation.title.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'conversation'}.txt`;
    link.click();
    URL.revokeObjectURL(url);
  }

  getTime(): string {
    return new Date().toLocaleTimeString([], {
      hour: '2-digit',
      minute: '2-digit'
    });
  }

  private createId(): string {
    return `${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
  }

  private async authenticate(user: AuthUser): Promise<void> {
    this.currentUserEmail = user.email;
    this.currentUserName = user.name;
    this.isAdmin = user.isAdmin;
    this.isAuthenticated = true;
    this.loadPreferences();
    this.changeDetector.markForCheck();
    void this.loadConversations();
    if (this.isAdmin) void this.loadAdminUsers();
  }

  private loadPreferences(): void {
    if (!isPlatformBrowser(this.platformId) || !this.currentUserEmail) return;
    try {
      const key = `morrow-preferences:${encodeURIComponent(this.currentUserEmail)}`;
      const stored = localStorage.getItem(key);
      if (!stored) return;
      const preferences = JSON.parse(stored) as Partial<Chatbot>;
      this.enterToSend = preferences.enterToSend ?? this.enterToSend;
      this.soundEffects = preferences.soundEffects ?? this.soundEffects;
      this.compactResponses = preferences.compactResponses ?? this.compactResponses;
      this.language = preferences.language ?? this.language;
      this.appearance = preferences.appearance === 'dark' ? 'dark' : 'light';
    } catch {
      localStorage.removeItem(`morrow-preferences:${encodeURIComponent(this.currentUserEmail)}`);
    }
  }

  private async loadAdminUsers(): Promise<void> {
    try {
      const response = await fetch('/api/admin/users', { credentials: 'same-origin' });
      if (!response.ok) return;
      const result = await response.json() as { users?: AdminUser[] };
      this.adminUsers = Array.isArray(result.users) ? result.users : [];
      this.changeDetector.markForCheck();
    } catch {
      this.adminUsers = [];
    }
  }

  openAdminPanel(): void {
    if (!this.isAdmin) return;
    this.showAdminPanel = true;
    this.sidebarOpen = false;
    void this.loadAdminUsers();
  }

  closeAdminPanel(): void {
    this.showAdminPanel = false;
  }

  openSettings(): void {
    this.showSettings = true;
    this.showAdminPanel = false;
    this.sidebarOpen = false;
  }

  closeSettings(): void {
    this.showSettings = false;
  }

  savePreferences(): void {
    if (!isPlatformBrowser(this.platformId) || !this.currentUserEmail) return;
    localStorage.setItem(`morrow-preferences:${encodeURIComponent(this.currentUserEmail)}`, JSON.stringify({
      enterToSend: this.enterToSend,
      soundEffects: this.soundEffects,
      compactResponses: this.compactResponses,
      language: this.language,
      appearance: this.appearance
    }));
  }

  private async loadConversations(): Promise<void> {
    this.conversations = [{ id: 'welcome', title: 'New conversation', updatedAt: Date.now(), messages: [] }];
    this.activeConversationId = 'welcome';

    try {
      const response = await fetch('/api/conversations', { credentials: 'same-origin' });
      if (!response.ok) return;
      const result = await response.json() as { conversations?: Conversation[] };
      const conversations = result.conversations;
      if (Array.isArray(conversations) && conversations.length > 0) {
        this.conversations = conversations;
        this.activeConversationId = conversations[0].id;
      }
    } catch {
      this.authError = 'Unable to load your previous conversations.';
    }
  }

  private persistConversations(): void {
    if (!isPlatformBrowser(this.platformId) || !this.currentUserEmail) return;
    void Promise.all(this.conversations.map(conversation =>
      fetch(`/api/conversations/${encodeURIComponent(conversation.id)}`, {
        method: 'PUT',
        credentials: 'same-origin',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(conversation)
      })
    )).catch(() => {
      // Keep the current conversation usable when a save is temporarily unavailable.
    });
  }
}
