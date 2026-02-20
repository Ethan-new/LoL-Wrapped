class AddTeamBansToRecapYearStats < ActiveRecord::Migration[7.2]
  def change
    add_column :recap_year_stats, :our_team_bans, :jsonb, default: []
    add_column :recap_year_stats, :enemy_team_bans, :jsonb, default: []
  end
end
