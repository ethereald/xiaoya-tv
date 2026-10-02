export interface User {
  id: number;
  username: string;
  role: 'admin' | 'user';
}

export interface Category {
  id: string;
  name: string;
}

export interface CatalogItem {
  id: string;
  title: string;
  poster: string;
  quality: string;
  category: string;
  description: string;
}

export interface StreamSource {
  id: string;
  name: string;
  url: string;
}

export interface Episode {
  index: number;
  label: string;
  sources: StreamSource[];
}

export interface MediaDetail extends CatalogItem {
  year: string;
  episodes: Episode[];
}

export interface ProgressRecord {
  media_id: string;
  title: string;
  poster: string;
  episode: number;
  total_episodes: number;
  position_ms: number;
  duration_ms: number;
  completed: number;
  updated_at: number;
}

export interface FavoriteRecord {
  media_id: string;
  title: string;
  poster: string;
  category: string;
  total_episodes: number;
  created_at: number;
}
