Rails.application.routes.draw do
  require "sidekiq/web"
  mount Sidekiq::Web => "/sidekiq"

  # Define your application routes per the DSL in https://guides.rubyonrails.org/routing.html

  # Reveal health status on /up that returns 200 if the app boots with no exceptions, otherwise 500.
  # Can be used by load balancers and uptime monitors to verify that the app is live.
  get "up" => "rails/health#show", as: :rails_health_check

  # Render dynamic PWA files from app/views/pwa/*
  get "service-worker" => "rails/pwa#service_worker", as: :pwa_service_worker
  get "manifest" => "rails/pwa#manifest", as: :pwa_manifest

  root "players#index"
  post "players/lookup", to: "players#lookup"

  post "players/:id/ingest_year", to: "players#ingest_year", as: :ingest_year_player, constraints: { id: /\d+/ }
  post "players/:id/compute_recap", to: "players#compute_recap", as: :compute_recap_player, constraints: { id: /\d+/ }
  get "players/:id/recap/:year", to: "recaps#show", as: :player_recap, constraints: { id: /\d+/, year: /\d{4}/ }

  get "players/:region/:riot_id_slug", to: "players#show", as: :player,
      constraints: { region: /na|eu|asia|sea/, riot_id_slug: /[^\/]+/ }
  patch "players/:region/:riot_id_slug", to: "players#update", as: :update_player,
        constraints: { region: /na|eu|asia|sea/, riot_id_slug: /[^\/]+/ }
end
