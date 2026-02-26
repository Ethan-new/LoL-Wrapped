# frozen_string_literal: true

class PlayersController < ApplicationController
  skip_before_action :allow_browser, if: -> { request.format.json? }, raise: false

  def index
  end

  def recap_statuses
    player = Player.find_by(id: params[:id])
    return render json: { error: "Player not found" }, status: :not_found unless player

    payload = { recap_statuses: player.recap_statuses || {} }
    if player.respond_to?(:recap_failure_reasons) && player.recap_failure_reasons.present?
      payload[:recap_failure_reasons] = player.recap_failure_reasons
    end
    year_str = (Time.current.year - 1).to_s
    year_int = Time.current.year - 1
    if payload[:recap_statuses][year_str] == "generating"
      progress = IngestProgress.new.get_progress(player.id, year_int)
      if progress.present?
        payload[:ingest_progress] = {
          phase: progress["phase"],
          downloaded: progress["downloaded"],
          processed: progress["processed"]
        }.compact
        payload[:ingest_progress][:queue_position] = queue_position_for_job(progress["job_id"]) if progress["phase"] == "downloading" && progress["job_id"].present?
      end
    end
    render json: payload, status: :ok
  end

  def compute_recap
    player = Player.find_by(id: params[:id])
    return render json: { error: "Player not found" }, status: :not_found unless player

    year = params[:year].to_i
    previous_year = Time.current.year - 1
    if year != previous_year
      return render json: { error: "Recap is only available for #{previous_year}. Current year recaps will be available next year." }, status: :unprocessable_entity
    end

    player.update!(recap_statuses: (player.recap_statuses || {}).merge(year.to_s => "generating"))
    ComputeMostPlayedWithJob.perform_later(player.id, year)
    render json: {
      status: "queued",
      player_id: player.id,
      year: year,
      message: "ComputeMostPlayedWithJob enqueued",
      recap_statuses: player.reload.recap_statuses
    }, status: :accepted
  end

  def ingest_year
    player = Player.find_by(id: params[:id])
    return render json: { error: "Player not found" }, status: :not_found unless player

    lock = IngestLock.new
    if ActiveModel::Type::Boolean.new.cast(params[:force])
      lock.release!(player.id)
    end
    if lock.locked?(player.id)
      return render json: { error: "Recap generation already in progress. Please wait for it to finish." }, status: :conflict
    end

    year = params[:year].to_i
    previous_year = Time.current.year - 1
    if year != previous_year
      return render json: { error: "Recap is only available for #{previous_year}. Current year recaps will be available next year." }, status: :unprocessable_entity
    end

    attrs = { recap_statuses: (player.recap_statuses || {}).merge(year.to_s => "generating") }
    attrs[:recap_failure_reasons] = (player.recap_failure_reasons || {}).except(year.to_s) if player.respond_to?(:recap_failure_reasons)
    player.update!(attrs)
    job = IngestYearJob.perform_later(player.id, year)
    jid = job.provider_job_id || job.job_id # Sidekiq JID for queue lookup
    IngestProgress.new.set_progress(player.id, year, phase: "downloading", downloaded: 0, job_id: jid)
    queue_pos = queue_position_for_job(jid)
    render json: {
      status: "queued",
      player_id: player.id,
      year: year,
      job_id: jid,
      recap_statuses: player.reload.recap_statuses,
      ingest_progress: { phase: "downloading", queue_position: queue_pos, downloaded: 0 }
    }, status: :accepted
  end

  def show
    game_name, tag_line = params[:riot_id_slug].to_s.rpartition("-").then { |name, _, tag| [ name, tag ] }
    game_name = sanitize_riot_id_input(game_name)
    tag_line = sanitize_riot_id_input(tag_line)
    riot_id = "#{game_name}##{tag_line}"
    riot_region = RegionMapping.riot_region(params[:region])

    @player = Player.find_by(riot_id: riot_id, region: riot_region)
    unless @player
      if game_name.present? && tag_line.present? && game_name.length.between?(3, 16) && tag_line.length.between?(3, 5) && riot_region
        @player = find_or_create_player_from_url(region_slug: params[:region], game_name: game_name, tag_line: tag_line)
      end
    end

    respond_to_error("Player not found", [], :not_found) unless @player
  rescue RiotClient::NotFound
    respond_to_error("Riot account not found", [], :not_found, show_region_hint: true)
  rescue RiotClient::ApiError, RiotClient::ArgumentError => e
    respond_to_error(e.message, [], :unprocessable_entity)
  end

  def update
    @player = load_player_from_params
    return head :not_found unless @player

    if @player.last_synced_at && @player.last_synced_at > 5.seconds.ago
      respond_to do |format|
        format.html { redirect_to player_path(region: params[:region], riot_id_slug: params[:riot_id_slug]), alert: "Please wait 5 seconds before updating again." }
        format.json { render json: { error: "Rate limited. Try again in 5 seconds." }, status: :too_many_requests }
      end
      return
    end

    refresh_player_data(@player)

    respond_to do |format|
      format.html { redirect_to player_path(region: params[:region], riot_id_slug: params[:riot_id_slug]), notice: "Profile refreshed." }
      format.json { render json: player_response(@player), status: :ok }
    end
  rescue RiotClient::NotFound, RiotClient::ApiError => e
    respond_to do |format|
      format.html { redirect_to player_path(region: params[:region], riot_id_slug: params[:riot_id_slug]), alert: "Failed to refresh: #{e.message}" }
      format.json { render json: { error: e.message }, status: :unprocessable_entity }
    end
  end

  def lookup
    unless valid_params?
      return respond_to_error("Please fix the following", param_errors, :unprocessable_entity)
    end

    normalized = normalized_lookup_params
    riot_region = RegionMapping.riot_region(normalized[:region])
    riot_id = "#{normalized[:game_name]}##{normalized[:tag_line]}"
    player = Player.find_by(riot_id: riot_id, region: riot_region)

    unless player
      account_data = fetch_riot_account
      player = find_or_create_player(account_data)
    end

    respond_to_success(player)
  rescue RiotClient::NotFound
    respond_to_error("Riot account not found", [], :not_found, show_region_hint: true)
  rescue RiotClient::ApiError, RiotClient::ArgumentError => e
    respond_to_error(e.message, [], :unprocessable_entity)
  rescue ActiveRecord::RecordInvalid => e
    respond_to_error("Failed to save player", e.record.errors.full_messages, :unprocessable_entity)
  end

  private

  def lookup_params
    params.permit(:game_name, :tag_line, :riot_id, :region)
  end

  def valid_params?
    param_errors.empty?
  end

  def param_errors
    errors = []
    normalized = normalized_lookup_params
    game_name, tag_line = normalized.values_at(:game_name, :tag_line)
    if game_name.blank? || tag_line.blank?
      errors << (lookup_params[:riot_id].present? ? "Use the format Name#TagLine (e.g. Pobelter#NA1)" : "Enter your Riot ID to get started")
    end
    errors << "Game name (before #) should be 3–16 characters" if game_name.present? && !game_name.length.between?(3, 16)
    errors << "Tag line (after #) should be 3–5 characters, e.g. NA1" if tag_line.present? && !tag_line.length.between?(3, 5)
    errors << "Please select your region" if normalized[:region].blank?
    errors
  end

  def fetch_riot_account
    normalized = normalized_lookup_params
    riot_region = RegionMapping.riot_region(normalized[:region])
    RiotClient.new.fetch_account_by_riot_id(
      game_name: normalized[:game_name],
      tag_line: normalized[:tag_line],
      region: riot_region
    )
  end

  def normalized_lookup_params
    sanitized = sanitize_riot_id_input(lookup_params[:riot_id].to_s)
    game_name, tag_line = parse_riot_id(sanitized)
    {
      game_name: game_name.presence || sanitize_riot_id_input(lookup_params[:game_name].to_s),
      tag_line: tag_line.presence || sanitize_riot_id_input(lookup_params[:tag_line].to_s),
      region: lookup_params[:region]
    }
  end

  def sanitize_riot_id_input(input)
    return "" if input.blank?
    # Remove null bytes, control chars, invalid UTF-8; strip and limit length
    input.encode("UTF-8", invalid: :replace, undef: :replace)
        .gsub(/[\x00-\x1F\x7F\u2028\u2029]/, "") # null, control chars, line/paragraph separators
        .strip
        .truncate(25, omission: "") # max "game_name#tagline" = 16+1+5
  end

  def parse_riot_id(riot_id)
    return [ nil, nil ] if riot_id.blank?
    parts = riot_id.split("#", 2)
    [ parts[0]&.strip.presence, parts[1]&.strip.presence ]
  end

  def find_or_create_player_from_url(region_slug:, game_name:, tag_line:)
    riot_region = RegionMapping.riot_region(region_slug)
    return nil unless riot_region

    account_data = RiotClient.new.fetch_account_by_riot_id(
      game_name: game_name,
      tag_line: tag_line,
      region: riot_region
    )
    find_or_create_player_with_region(account_data, riot_region)
  end

  def find_or_create_player(account_data)
    riot_region = RegionMapping.riot_region(lookup_params[:region])
    find_or_create_player_with_region(account_data, riot_region)
  end

  def find_or_create_player_with_region(account_data, riot_region)
    puuid = account_data[:puuid]
    riot_id = "#{account_data[:gameName]}##{account_data[:tagLine]}"

    summoner_result = fetch_summoner_data(puuid, riot_region)
    summoner_data = summoner_result&.dig(:data)
    platform = summoner_result&.dig(:platform)

    rank_entries = fetch_rank_entries_by_puuid(puuid, riot_region, platform: platform)

    Player.find_or_initialize_by(puuid: puuid).tap do |player|
      player.riot_id = riot_id
      player.region = riot_region
      if summoner_data
        player.summoner_id = summoner_data[:id]
        player.summoner_level = summoner_data[:summonerLevel]
        player.profile_icon_id = summoner_data[:profileIconId]
        player.revision_date = summoner_data[:revisionDate]
      end
      player.rank_entries = rank_entries
      player.save!
    end
  end

  def fetch_summoner_data(puuid, region)
    RiotClient.new.fetch_summoner_by_puuid(puuid: puuid, region: region)
  rescue RiotClient::NotFound, RiotClient::ApiError
    nil
  end

  def fetch_rank_entries_by_puuid(puuid, region, platform: nil)
    RiotClient.new.fetch_league_entries_by_puuid(puuid: puuid, region: region, platform: platform)
  rescue RiotClient::ApiError
    []
  end

  def load_player_from_params
    game_name, tag_line = params[:riot_id_slug].to_s.rpartition("-").then { |name, _, tag| [ name, tag ] }
    riot_id = "#{game_name}##{tag_line}"
    riot_region = RegionMapping.riot_region(params[:region])
    Player.find_by(riot_id: riot_id, region: riot_region)
  end

  def refresh_player_data(player)
    # Fetch from Riot API directly — do not use helpers that swallow errors.
    # On RiotClient::NotFound or RiotClient::ApiError, we let the exception propagate
    # so the controller rescues it and no DB update occurs.
    client = RiotClient.new
    summoner_result = client.fetch_summoner_by_puuid(puuid: player.puuid, region: player.region)
    summoner_data = summoner_result[:data]
    platform = summoner_result[:platform]
    rank_entries = client.fetch_league_entries_by_puuid(puuid: player.puuid, region: player.region, platform: platform)

    player.transaction do
      if summoner_data
        player.summoner_id = summoner_data[:id]
        player.summoner_level = summoner_data[:summonerLevel]
        player.profile_icon_id = summoner_data[:profileIconId]
        player.revision_date = summoner_data[:revisionDate]
      end
      player.rank_entries = rank_entries
      player.last_synced_at = Time.current
      player.save!
    end
  end

  def player_response(player)
    {
      id: player.id,
      url: player_url(region: player.path_params[:region], riot_id_slug: player.riot_id_slug),
      puuid: player.puuid,
      riot_id: player.riot_id,
      region: RegionMapping.region_slug(player.region),
      summoner_id: player.summoner_id,
      summoner_level: player.summoner_level,
      profile_icon_id: player.profile_icon_id,
      revision_date: player.revision_date,
      rank_entries: player.rank_entries,
      created_at: player.created_at,
      updated_at: player.updated_at
    }
  end

  def respond_to_success(player)
    respond_to do |format|
      format.html { redirect_to player_path(region: player.path_params[:region], riot_id_slug: player.riot_id_slug), notice: "Player found." }
      format.json { render json: player_response(player), status: :ok }
    end
  end

  def queue_position_for_job(job_id)
    return nil if job_id.blank?

    # If job is being processed, it's not in the queue
    return 0 if job_in_progress?(job_id)

    # Try queue names – IngestYearJob.queue_name may or may not include prefix depending on Rails
    queue_names = [ IngestYearJob.queue_name ]
    if (prefix = ActiveJob::Base.queue_name_prefix.presence)
      queue_names += [ "#{prefix}_default", "default" ]
    end
    queue_names = queue_names.compact.uniq

    queue_names.each do |queue_name|
      position = find_job_position_in_queue(queue_name, job_id)
      return position if position
    end
    nil
  rescue StandardError
    nil
  end

  def find_job_position_in_queue(queue_name, job_id)
    queue = Sidekiq::Queue.new(queue_name)
    size = queue.size
    position = nil
    queue.each_with_index do |job, idx|
      if job.jid.to_s == job_id.to_s
        # Sidekiq uses LPUSH (add left) + BRPOP (take right). List is [newest...oldest].
        # idx 0 = newest (back of queue), idx size-1 = oldest (next to run).
        position = size - idx
        break
      end
    end
    position&.positive? ? position : nil
  end

  def job_in_progress?(job_id)
    Sidekiq::Workers.new.any? { |_process_id, _thread_id, work| work.job&.jid == job_id }
  rescue StandardError
    false
  end

  def respond_to_error(message, details, status, show_region_hint: false)
    respond_to do |format|
      format.html do
        render :lookup_error,
          locals: { error: message, details: details, show_region_hint: show_region_hint },
          status: status
      end
      format.json { render json: { error: message, details: details }, status: status }
    end
  end
end
